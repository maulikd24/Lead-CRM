import { referralEnabled } from "./flag";
import type { PartnerProbe } from "./partner-probe";
import { refreshProgress, type RefreshResult } from "./refresh";
import { attributeAfterIngest } from "./webhook";
import type { ReferralStore } from "./store";

export type LedgerSignup = { userId: string; referralCode: string; clientId: string; receivedAt: Date; deviceHash?: string };

const LOOKBACK_DAYS = 45;
const errorName = (e: unknown) => (e instanceof Error ? e.name : "unknown");

/** App signups of the last weeks that carried a code and ended up creating a customer (the signup ledger is the source of truth). */
async function loadSignupsFromLedger(now: Date): Promise<LedgerSignup[]> {
  const { prisma } = await import("@/lib/db/prisma");
  const rows = await prisma.leadIntake.findMany({
    where: { source: "allvest_app", status: "CREATED", clientId: { not: null }, receivedAt: { gte: new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000) }, rawPayload: { path: ["normalized", "attribution", "referral_code"], string_contains: "" } },
    select: { externalId: true, clientId: true, receivedAt: true, rawPayload: true },
    take: 500,
  });
  return rows.flatMap((r) => {
    const payload = r.rawPayload as { raw?: { deviceHash?: unknown } | null; normalized?: { attribution?: { referral_code?: string } } } | null;
    const code = payload?.normalized?.attribution?.referral_code ?? "";
    const device = typeof payload?.raw?.deviceHash === "string" && /^[0-9a-f]{64}$/.test(payload.raw.deviceHash) ? payload.raw.deviceHash : undefined;
    return code && r.clientId ? [{ userId: r.externalId, referralCode: code, clientId: r.clientId, receivedAt: r.receivedAt, deviceHash: device }] : [];
  });
}

/**
 * The scheduled (and on-demand) referral job. A no-op unless REFERRAL_PROGRAM_ENABLED=1. First it credits any recent app
 * signup whose code the signup webhook could not (a crash between the signup and the credit); credits are idempotent per
 * app user and judged at the time of the signup, never later. Then it records new KYC and funding events and accrues rewards.
 */
export type JobResult = RefreshResult & { reattributed: number; failed: number; ledgerError?: string };

export async function runReferralJob(i: { env?: Record<string, string | undefined>; store?: ReferralStore; loadSignups?: (now: Date) => Promise<LedgerSignup[]>; partnerProbe?: PartnerProbe; now?: Date } = {}): Promise<{ skipped: string } | JobResult> {
  if (!referralEnabled(i.env ?? process.env)) return { skipped: "flag off" };
  const now = i.now ?? new Date();
  const store = i.store ?? (await import("./prisma-store")).prismaReferralStore;
  let reattributed = 0;
  let failed = 0;
  let ledgerError: string | undefined;
  let signups: LedgerSignup[] = [];
  try {
    signups = await (i.loadSignups ?? loadSignupsFromLedger)(now);
  } catch (error) {
    ledgerError = errorName(error);
    console.error("Referral job: signup ledger unreadable", ledgerError);
  }
  // One signup that keeps failing must never starve the others: each is isolated, counted, and retried on the next run
  // (credits are idempotent per app user). Logs carry the error class only: never the code, the app user id or a message.
  // The same path as the webhook (partner precedence, flags, the device), so a healed signup is judged exactly as a live one.
  for (const s of signups) {
    const r = await attributeAfterIngest({ env: i.env, store, contract: { userId: s.userId, referralCode: s.referralCode, deviceHash: s.deviceHash }, outcome: { status: "created", clientId: s.clientId }, now: s.receivedAt, partnerProbe: i.partnerProbe });
    if (r.status === "attributed") reattributed++;
    else if (r.status === "failed") failed++;
  }
  const refreshed = await refreshProgress({ store, now });
  return { reattributed, ...refreshed, failed: failed + refreshed.failed, ...(ledgerError ? { ledgerError } : {}) };
}

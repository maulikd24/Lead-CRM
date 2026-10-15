import { basePrisma, prisma } from "@/lib/db/prisma";
import { decryptJson } from "@/lib/security/crypto";
import { loadCustomerFacts } from "@/lib/intelligence/facts";
import { computeIntelligence } from "@/lib/intelligence/refresh";
import { checkedAfter, runBatch, type BatchResult } from "./batch-loop";
import { getLastHash, recordChecked, recordFailure, recordSuccess } from "./ledger";
import { signalsFromIntelligence } from "./mapping";
import { pushCustomerSignals, type PusherDeps } from "./pusher";
import { clevertapHost, isIndiaRegion, writesEnabled } from "./region";
import { loadAppUserId } from "./identity";
import { consentEnforced } from "@/lib/consent/enforce";
import { applyPushStance, pushStanceFor } from "@/lib/consent/push";
import { claimApprovedBatch, type BatchApprovalDb } from "./push-approval";

const ZERO: BatchResult = { pushed: 0, unchanged: 0, skipped: 0, retry: 0, failed: 0 };

/** Where a live push would go: the India region with an account id and passcode. Null when the integration is not live for India. */
export type LiveTarget = { region: string | undefined; url: string; accountId: string; passcode: string };

export async function loadLiveTarget(): Promise<LiveTarget | null> {
  const config = await prisma.integrationConfig.findUnique({ where: { provider: "clevertap" } });
  if (!config || !config.isEnabled || config.mode !== "live" || !config.credentials) return null;

  const credentials = decryptJson<Record<string, unknown>>(config.credentials as string);
  const region = credentials.region ? String(credentials.region) : undefined;
  if (!isIndiaRegion(region)) return null;
  const accountId = String(credentials.accountId ?? "");
  const passcode = String(credentials.passcode ?? "");
  if (!accountId || !passcode) return null;
  return { region, url: `https://${clevertapHost(region ?? "")}/1/upload`, accountId, passcode };
}

/**
 * Sends the one batch an Admin approved, then nothing more. The client ids are frozen in the approval payload: this tick never
 * selects customers itself. The approval is claimed (marked sent) before the first send, so a retry or an overlapping tick cannot
 * send it again. Off unless CLEVERTAP_PUSH_ENABLED=1, and a no-op unless the integration is live on the India region.
 */
export async function pushStaleSignals(): Promise<BatchResult> {
  if (!writesEnabled()) return { ...ZERO };

  const target = await loadLiveTarget();
  if (!target) return { ...ZERO };
  const { region, url, accountId, passcode } = target;

  // CONSENT_ENFORCEMENT=1 only: a customer who withdrew (or asked not to be contacted) is pushed with the existing av_sales_paused signal set.
  const consent = consentEnforced();

  const deps: PusherDeps = {
    region,
    mode: "live",
    load: async (clientId) => {
      const facts = await loadCustomerFacts(clientId);
      if (!facts) return null;
      // The identity is the app user id. A customer without one is skipped by the pusher, so no stray profile is created.
      const app = await loadAppUserId(basePrisma, clientId);
      // computeIntelligence is pure: unlike refreshCustomerIntelligence it writes nothing and can fire no journeys.
      const loaded = { identity: app.identity, skipReason: app.reason, signals: signalsFromIntelligence(computeIntelligence(facts)) };
      return consent ? applyPushStance(loaded, await pushStanceFor(clientId)) : loaded;
    },
    lastHash: (clientId) => getLastHash(basePrisma, clientId),
    record: (clientId, hash) => recordSuccess(basePrisma, clientId, hash),
    recordError: (clientId, message) => recordFailure(basePrisma, clientId, message),
    send: async (payload) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "X-CleverTap-Account-Id": accountId, "X-CleverTap-Passcode": passcode, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      return { ok: res.ok, status: res.status };
    },
  };

  // Human approval gate: the only batch that can go is an APPROVED request for this region, claimed once. Refusal logs the reason only.
  const gate = await claimApprovedBatch(basePrisma as unknown as BatchApprovalDb, region ?? "");
  if (!gate.allowed) {
    console.warn(`CleverTap push refused (${gate.reason}). Nothing was sent.`);
    return { ...ZERO };
  }

  const push = checkedAfter((id) => pushCustomerSignals(id, deps), (id) => recordChecked(basePrisma, id));
  return runBatch(gate.clientIds, push);
}

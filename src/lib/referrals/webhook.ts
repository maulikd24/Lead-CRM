import { attributeSignup, type SignupOutcome } from "./attribute";
import { normalizeCode } from "./code";
import { referralEnabled } from "./flag";
import { partnerCodeExists, partnerProgrammeLive, type PartnerProbe } from "./partner-probe";
import { resolveSignupCodes } from "./resolve";
import type { ReferralStore } from "./store";

const errorName = (e: unknown) => (e instanceof Error ? e.name : "unknown");

/**
 * The one hook the app-signup webhook calls after a signup has been ingested. Flag off: it returns before touching
 * anything. It NEVER throws and never changes the webhook's response: a failure here is logged (without the code, the
 * device hash or any personal data) and the signup still succeeds; the periodic refresh re-attributes from the lead ledger.
 *
 * Order: (1) remember the signup's hashed device, if the app sent one (abuse signals only); (2) work out who owns the code
 * (see resolve.ts: a partner code is always the partner's, and is never taken away); (3) credit the referral, flagged when a
 * partner code was also present.
 */
export async function attributeAfterIngest(i: {
  env?: Record<string, string | undefined>;
  store?: ReferralStore;
  contract: { userId: string; referralCode?: string; partnerCode?: string; deviceHash?: string };
  outcome: SignupOutcome;
  now?: Date;
  /** The partner programme's code lookup (see partner-probe.ts). */
  partnerProbe?: PartnerProbe;
  /** Whether the partner programme is credited right now (default: its flag). */
  partnerProgrammeLive?: () => boolean;
}): Promise<{ status: "attributed" | "rejected" | "replay" | "skipped" | "failed" | "partner" }> {
  if (!referralEnabled(i.env ?? process.env)) return { status: "skipped" };
  const { contract, outcome } = i;
  const clientId = outcome.status === "created" || outcome.status === "duplicate" || (outcome.status === "replay" && outcome.clientId) ? outcome.clientId : undefined;
  if (!(contract.referralCode || contract.partnerCode) && !(contract.deviceHash && clientId)) return { status: "skipped" };
  try {
    const store = i.store ?? (await import("./prisma-store")).prismaReferralStore;
    if (contract.deviceHash && clientId) {
      try {
        await store.recordDevice(clientId, contract.deviceHash);
      } catch (error) {
        console.error("Referral device record failed", errorName(error));
      }
    }
    if (!contract.referralCode && !contract.partnerCode) return { status: "skipped" };

    const probe = i.partnerProbe ?? partnerCodeExists;
    const asksPartner = async (code: string | undefined) => {
      if (!code) return false;
      try {
        return await probe(code.trim());
      } catch (error) {
        console.error("Referral partner-code lookup failed", errorName(error));
        return false;
      }
    };
    const normalized = normalizeCode(contract.referralCode);
    const resolution = resolveSignupCodes({
      referralCode: contract.referralCode,
      partnerCode: contract.partnerCode,
      partnerMatchesReferralCode: await asksPartner(contract.referralCode),
      partnerMatchesPartnerCode: await asksPartner(contract.partnerCode),
      partnerProgrammeLive: (i.partnerProgrammeLive ?? (() => partnerProgrammeLive(i.env ?? process.env)))(),
      consumerCodeExists: normalized ? (await store.findCodeByValue(normalized)) !== null : false,
    });
    if (!resolution.recordReferral) return { status: "partner" };

    const r = await attributeSignup({ store, userId: contract.userId, referralCode: contract.referralCode, outcome, signedUpAt: i.now ?? new Date(), flags: resolution.flags, deviceHash: contract.deviceHash });
    return { status: r.status };
  } catch (error) {
    console.error("Referral attribution failed", errorName(error));
    return { status: "failed" };
  }
}

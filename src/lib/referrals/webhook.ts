import { attributeSignup, type SignupOutcome } from "./attribute";
import { referralEnabled } from "./flag";
import type { ReferralStore } from "./store";

/**
 * The one hook the app-signup webhook calls after a signup has been ingested. Flag off: it returns before touching
 * anything. It NEVER throws and never changes the webhook's response: a failure here is logged (without the code or any
 * personal data) and the signup still succeeds; the periodic refresh re-attributes from the lead ledger.
 */
export async function attributeAfterIngest(i: {
  env?: Record<string, string | undefined>;
  store?: ReferralStore;
  contract: { userId: string; referralCode?: string };
  outcome: SignupOutcome;
  now?: Date;
}): Promise<{ status: "attributed" | "rejected" | "replay" | "skipped" | "failed" }> {
  if (!referralEnabled(i.env ?? process.env) || !i.contract.referralCode) return { status: "skipped" };
  try {
    const store = i.store ?? (await import("./prisma-store")).prismaReferralStore;
    const r = await attributeSignup({ store, userId: i.contract.userId, referralCode: i.contract.referralCode, outcome: i.outcome, signedUpAt: i.now ?? new Date() });
    return { status: r.status };
  } catch (error) {
    console.error("Referral attribution failed", error instanceof Error ? error.name : "unknown");
    return { status: "failed" };
  }
}

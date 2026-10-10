import { createHash } from "node:crypto";

import { decideAttribution } from "./attribution";
import { normalizeCode } from "./code";
import type { ReferralStore } from "./store";

/** The subset of the lead-intake outcome this module reads (kept structural so it does not import the lead pipeline). */
export type SignupOutcome =
  | { status: "created"; clientId: string }
  | { status: "duplicate"; clientId: string }
  | { status: "replay"; previous: string; clientId?: string }
  | { status: "rejected"; reason: string }
  | { status: "error"; error: string };

export type AttributeResult = { status: "attributed" } | { status: "rejected"; reason: string } | { status: "replay" } | { status: "skipped" };

/** The idempotency key: one claim per app user, so a retried or replayed signup never attributes twice. It is a hash, so the app user id is not stored in the referral tables. */
export const claimKey = (userId: string) => `allvest_app:${createHash("sha256").update(userId).digest("hex")}`;

/**
 * Credits a signup that carried a referral code. It is called AFTER the signup has been ingested and never decides whether
 * the signup succeeds: the caller treats any failure here as a logged non-event. Idempotent per app user; first touch wins.
 */
export async function attributeSignup(i: { store: ReferralStore; userId: string; referralCode: string | undefined; outcome: SignupOutcome; signedUpAt: Date }): Promise<AttributeResult> {
  if (!i.referralCode) return { status: "skipped" };
  let clientId: string | undefined;
  let outcome: "created" | "duplicate";
  if (i.outcome.status === "created") [clientId, outcome] = [i.outcome.clientId, "created"];
  else if (i.outcome.status === "duplicate") [clientId, outcome] = [i.outcome.clientId, "duplicate"];
  else if (i.outcome.status === "replay" && i.outcome.previous === "CREATED" && i.outcome.clientId) [clientId, outcome] = [i.outcome.clientId, "created"];
  else return { status: "skipped" };

  const key = claimKey(i.userId);
  if (await i.store.findClaim(key)) return { status: "replay" };

  const normalized = normalizeCode(i.referralCode);
  const code = normalized ? await i.store.findCodeByValue(normalized) : null;
  const referred = await i.store.loadParty(clientId);
  if (!referred) return { status: "skipped" };

  const decision = decideAttribution({
    code,
    referrerStatus: code?.referrerStatus ?? "ACTIVE",
    referrer: code?.referrer ?? null,
    referred,
    outcome,
    signedUpAt: i.signedUpAt,
    alreadyAttributed: await i.store.isReferred(clientId),
  });

  const saved = await i.store.saveClaim(
    decision.kind === "attribute"
      ? { key, referrerId: decision.referrerId, codeId: decision.codeId, referredClientId: clientId, outcome: "ATTRIBUTED", reason: null, attributedAt: i.signedUpAt }
      : { key, referrerId: code?.referrerId ?? null, codeId: code?.id ?? null, referredClientId: null, outcome: "REJECTED", reason: decision.reason, attributedAt: i.signedUpAt },
  );
  if (saved === "conflict") return { status: "replay" };
  return decision.kind === "attribute" ? { status: "attributed" } : { status: "rejected", reason: decision.reason };
}

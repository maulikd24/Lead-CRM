/**
 * Referral progress: Signed up > KYC complete > First funding. Events are DERIVED from data the CRM already holds (the
 * KYC record and the funding record); nothing is invented and nothing is re-timed once recorded. Order is enforced: a
 * funding is not recorded until the KYC event exists.
 */
export const EVENT_TYPES = ["SIGNED_UP", "KYC_COMPLETE", "FIRST_FUNDING"] as const;
export type ReferralEventType = (typeof EVENT_TYPES)[number];

export const EVENT_LABEL: Record<ReferralEventType, string> = { SIGNED_UP: "Signed up", KYC_COMPLETE: "KYC complete", FIRST_FUNDING: "First funding" };

/**
 * What the customer's own records show now. `kycReversedAt` / `fundingReversedAt` are set when a record that qualified is
 * no longer qualifying (KYC not approved, funding not in place): the time it last changed, which is when clawbacks judge the window.
 */
export type Evidence = { kycApprovedAt: Date | null; firstFundedAt: Date | null; fundedAmountPaise: number | null; kycReversedAt?: Date | null; fundingReversedAt?: Date | null };
export type NewEvent = { type: ReferralEventType; occurredAt: Date; amountPaise: number | null };

export function deriveEvents(evidence: Evidence, recorded: ReadonlySet<string>): NewEvent[] {
  const out: NewEvent[] = [];
  let kycDone = recorded.has("KYC_COMPLETE");
  if (!kycDone && evidence.kycApprovedAt) {
    out.push({ type: "KYC_COMPLETE", occurredAt: evidence.kycApprovedAt, amountPaise: null });
    kycDone = true;
  }
  if (kycDone && !recorded.has("FIRST_FUNDING") && evidence.firstFundedAt) {
    out.push({ type: "FIRST_FUNDING", occurredAt: evidence.firstFundedAt, amountPaise: Math.max(0, evidence.fundedAmountPaise ?? 0) });
  }
  return out;
}

export function currentStage(recorded: ReadonlySet<string>): ReferralEventType {
  for (let i = EVENT_TYPES.length - 1; i >= 0; i--) if (recorded.has(EVENT_TYPES[i])) return EVENT_TYPES[i];
  return "SIGNED_UP";
}

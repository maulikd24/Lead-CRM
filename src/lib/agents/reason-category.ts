/**
 * The only description of "why we are nudging" that ever leaves the building: a fixed enum value derived from the
 * programme and situations. Free text (reason, topic, talking points) can carry names, dates of birth or document
 * details, so it stays on our side and is stored on the AgentProposal for the RM only.
 */
export const REASON_CATEGORIES = ["kyc_pending", "kyc_stuck_in_documents", "funded_no_first_transaction", "signed_up_not_funded", "other_onboarding"] as const;
export type ReasonCategory = (typeof REASON_CATEGORIES)[number];

type BriefingLike = { whyContactingNow: { programme: string; topic: string | null }; currentSituations: { key: string }[] };

export function reasonCategoryFor(b: BriefingLike): ReasonCategory {
  const { programme, topic } = b.whyContactingNow;
  if (programme === "Complete KYC") return /document/i.test(topic ?? "") ? "kyc_stuck_in_documents" : "kyc_pending";
  if (programme === "Fund account") return "signed_up_not_funded";
  if (programme === "First transaction" && b.currentSituations.some((s) => s.key === "funded_no_first_transaction")) return "funded_no_first_transaction";
  return "other_onboarding";
}

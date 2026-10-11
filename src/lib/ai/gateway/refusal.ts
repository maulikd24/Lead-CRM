import type { GatewayResult } from "./types";

/** Plain-English text for a call that did not return an answer, safe to show a person. Never carries customer text. */
export function describeRefusal(r: Exclude<GatewayResult, { kind: "ok" }>): string {
  switch (r.kind) {
    case "blocked":
      switch (r.reason) {
        case "kill_switch": return "AI is switched off for this feature.";
        case "budget_exceeded": return "The daily AI budget for this feature has been reached. Try again tomorrow or ask an Admin to raise it.";
        case "budget_unset":
        case "budget_unavailable": return "AI is not available here until an Admin sets a daily budget for this feature.";
        case "consent_denied":
        case "consent_subject_missing":
        case "consent_unavailable": return "This customer has not agreed to AI processing, so nothing was sent to the AI provider.";
        default: return "The AI request was blocked by a safety check.";
      }
    case "abstain":
      return r.reason === "do_not_contact" ? "This customer is marked do-not-contact, so nothing was sent to the AI provider."
        : r.reason === "data_stale" ? "The data behind this is too old to rely on."
        : r.reason === "human_review_required" ? "This needs a person to look at it."
        : r.reason === "evidence_conflict" ? "The evidence conflicts, so no answer was given."
        : "There is not enough information to answer.";
    case "failed":
      return r.errorClass === "not_configured" ? "AI is not set up yet: an Admin needs to add the provider key." : "The AI provider could not be reached. Please try again.";
  }
}

import type { DraftOutcome } from "./generate";

/**
 * Plain-language refusal copy for the inbox (AI execution layer, bible 08). The internal reasons are written for logs and tests; the
 * RM sees only these sentences. `canHandOver` says whether the screen should offer a hand-over to the RM. A conversation that was
 * already handed over by the drafter says so and offers nothing more.
 */
export type RefusalCopy = { message: string; canHandOver: boolean };

const SALES_BLOCKED = "A sales draft is blocked for this customer: sales topics are set aside on their record.";
const COMPLAINT_OPEN = "A sales draft is blocked: this customer has an open complaint or compliance concern on record.";

/** Copy for a draft that was not made (the outcome is refused or blocked). */
export function draftRefusalCopy(outcome: Exclude<DraftOutcome, { status: "draft" }>): RefusalCopy {
  if (outcome.status === "blocked") {
    return { message: "Drafting is not available for this customer right now. Write the reply yourself, or hand the conversation to your RM.", canHandOver: true };
  }
  const r = outcome.reason;
  if (outcome.routeToHandover) {
    return { message: "The draft suggested an action or a product, so nothing was stored. The conversation has been passed to your RM.", canHandOver: false };
  }
  if (r.includes("sales topics are set aside")) return { message: SALES_BLOCKED, canHandOver: true };
  if (r.includes("open complaint or compliance concern")) return { message: COMPLAINT_OPEN, canHandOver: true };
  if (r.includes("asked not to be contacted")) return { message: "This customer has asked not to be contacted, so nothing was drafted.", canHandOver: false };
  if (r.includes("customer not found")) return { message: "This customer could not be found, so no draft was made.", canHandOver: false };
  if (r.includes("no match terms")) {
    return { message: "A do-not-discuss topic on this customer's record cannot be checked yet, so no draft was made. Fix the record, or hand the conversation to your RM.", canHandOver: true };
  }
  if (r.includes("judge unavailable")) {
    return { message: "The compliance check was unavailable, so no draft was stored. Try again later, or hand the conversation to your RM.", canHandOver: true };
  }
  if (r.includes("template draft failed")) {
    return { message: "No draft could be written for this customer that passes the compliance checks. Write the reply yourself, or hand the conversation to your RM.", canHandOver: true };
  }
  return { message: "No draft was made for this customer. Write the reply yourself, or hand the conversation to your RM.", canHandOver: true };
}

/** Copy for an RM-edited message that fails the checks at approval time. Nothing is stored. */
export function approvalRefusalCopy(reason: string): RefusalCopy {
  if (reason.includes("do-not-discuss topic")) {
    return { message: "The message touches a do-not-discuss topic for this customer, so it cannot be sent for approval. Remove that part and try again.", canHandOver: true };
  }
  if (reason.includes("sales topics are set aside")) return { message: SALES_BLOCKED, canHandOver: true };
  if (reason.includes("recommendation intent")) {
    return { message: "The message suggests an action or a product, which an AI draft cannot do. Reword it, or hand the conversation to your RM.", canHandOver: true };
  }
  if (reason.includes("open complaint or compliance concern")) return { message: COMPLAINT_OPEN, canHandOver: true };
  if (reason === "the message is empty") return { message: "Write a message before sending it for approval.", canHandOver: false };
  if (reason.includes("customer not found")) return { message: "This customer could not be found, so nothing was sent for approval.", canHandOver: false };
  return { message: "The message did not pass the send checks, so it cannot be sent for approval. Edit it and try again.", canHandOver: true };
}

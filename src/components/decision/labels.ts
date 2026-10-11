// Plain-language labels for the Evidence Drawer. Pure, so the wording is tested. Scores and confidence are ALWAYS labelled as heuristics.
import type { Confirmation, DecisionAction } from "@/lib/intelligence/decision/types";

export const SCORE_NOTE = "Priority score (heuristic, not a probability)";
export const CONFIDENCE_NOTE = "Confidence (heuristic label, not a probability)";

/** `kind` decides what an evidence line that is neither confirmed nor inferred is: a rule that fired, or context. */
export const confirmationLabel = (c: Confirmation, kind: string = "rule"): string => (c === "confirmed" ? "Confirmed" : c === "ai_inferred" ? "AI-inferred, unconfirmed" : kind === "rule" ? "Rule" : "Context");

export const sourceLabel = (kind: string): string => ({ fact: "Customer facts", memory: "Conversation memory", event: "Recent event", rule: "Rule" })[kind] ?? kind;

export const confidenceLabel = (c: string): string => (c === "high" ? "High" : c === "medium" ? "Medium" : "Low");

export const channelLabel = (c: string): string => ({ call: "Call", whatsapp: "WhatsApp", email: "Email", in_person: "In person", none: "No contact (internal step)" })[c] ?? c;

export const effectLabel = (e: string): string => (e === "block" ? "Blocked" : e === "delay" ? "Delayed" : e === "downrank" ? "Ranked lower" : e);

export const feedbackLabel = (k: string): string => ({ accept: "Accepted", done: "Marked done", snooze: "Snoozed", wrong: "Marked wrong", not_now: "Not now", dnr: "Do not recommend", ignored: "Ignored", expired: "Replaced by a newer decision" })[k] ?? k;

export const WRONG_LABEL: Record<string, string> = { wrong_fact: "A fact is wrong", already_done: "Already done", wrong_customer: "Wrong customer", wrong_channel: "Wrong channel", wrong_product: "Wrong product" };
export const DNR_LABEL: Record<string, string> = { customer_asked: "The customer asked not to be offered it", not_suitable: "Not suitable for this customer", already_holds: "Already holds it", other: "Other reason" };
export const OUTCOME_LABEL: Record<string, string> = { contact: "A contact followed", response: "The customer replied", interaction_outcome: "An outcome was logged", kyc: "KYC completed", funding: "Funding received", complaint_resolved: "A complaint was resolved" };

export function shortDate(iso: string | null): string {
  if (!iso) return "date unknown";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

export function ageText(iso: string | null, now: Date): string {
  if (!iso) return "date unknown";
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

export function actionHeadline(d: { result: string; action: DecisionAction | string; programme: string; topic: string | null }): string {
  if (d.result === "NO_ACTION") return "Nothing to do right now";
  if (d.result === "ABSTAIN") return "No recommendation";
  return `${d.action}: ${d.topic ?? d.programme}`;
}

/** Plain sentence for the policy block. */
export function policyLines(p: { consent: string; consentPurpose: string | null; consentReason: string | null; window: string; guardrails: string; approvalNeeded: boolean; approver: string | null }): { label: string; value: string; ok: boolean }[] {
  const purpose = p.consentPurpose ? p.consentPurpose.toLowerCase().replace(/_/g, " ") : null;
  return [
    { label: "Consent", value: p.consentPurpose === null ? "Not needed: an internal step" : p.consent === "ok" ? `OK for ${purpose}` : `Blocked for ${purpose}`, ok: p.consent === "ok" },
    { label: "WhatsApp window", value: p.window === "not_applicable" ? "Not applicable" : p.window === "ok" ? "Open: free text allowed" : "Closed: approved template or a call only", ok: p.window !== "closed" },
    { label: "Wording guardrails", value: p.guardrails === "ok" ? "OK" : "Flagged: not allowed as written", ok: p.guardrails === "ok" },
    { label: "Approval", value: p.approvalNeeded ? `Needed before anything is sent${p.approver ? ` (${p.approver} approves)` : ""}` : "Not needed: nothing is sent", ok: true },
  ];
}

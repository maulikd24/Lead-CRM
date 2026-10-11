import { other } from "./builders";
import type { DecisionScenario, EvalCase } from "../types";

const d = (expect: "block" | "allow", category: string, note: string, scenario: DecisionScenario): EvalCase => other(category, "en", { expect, kind: "decision", note, scenario });

/**
 * Decision Engine v2 golden customers (spec section 10). One synthetic customer per row: a candidate a generator proposes and what the customer's
 * data says. block = the engine did not recommend it as proposed (a missed block is a release blocker); allow = it recommended it unchanged.
 */
export const DECISION_CASES: EvalCase[] = [
  // ---- complaint, decline, acceptance, dismissal: the hard suppressions
  d("block", "decision_suppression", "open complaint stops a PMS pitch", { target: "pms_call", ctx: { complaintOpen: true } }),
  d("block", "decision_suppression", "open complaint stops a mutual fund WhatsApp", { target: "mf_whatsapp", ctx: { complaintOpen: true } }),
  d("block", "decision_suppression", "a complaint 10 days ago still stops a pitch", { target: "pms_call", ctx: { complaintDaysAgo: 10 } }),
  d("block", "decision_suppression", "open complaint also holds an onboarding reminder (only service recovery is allowed)", { target: "kyc_whatsapp", ctx: { complaintOpen: true } }),
  d("block", "decision_suppression", "declined PMS within 30 days", { target: "pms_call", ctx: { declined: "PMS" } }),
  d("block", "decision_suppression", "RM marked PMS acceptance Low", { target: "pms_call", ctx: { rmLow: "PMS" } }),
  d("block", "decision_suppression", "snoozed item stays away while the snooze runs", { target: "pms_call", ctx: { dismissed: "active" } }),
  d("block", "decision_suppression", "do-not-recommend entry for the class", { target: "pms_call", ctx: { dnr: true } }),
  d("block", "decision_suppression", "unreachable twice: no more call attempts", { target: "pms_call", ctx: { unreachable: 2 } }),
  d("block", "decision_suppression", "open exception: only its resolution is allowed", { target: "kyc_whatsapp", ctx: { exception: true } }),
  d("block", "decision_suppression", "contacted 5 hours ago: delayed, not recommended now", { target: "pms_call", ctx: { contactHoursAgo: 5 } }),
  d("block", "decision_suppression", "contacted 47 hours ago is still inside the 48 hour delay", { target: "mf_whatsapp", ctx: { contactHoursAgo: 47 } }),
  d("block", "decision_suppression", "data older than the hard limit cannot be the basis", { target: "pms_call", ctx: { stale: "hard" } }),
  // ---- consent and channel policy
  d("block", "decision_policy", "no marketing consent on record: a sales call is blocked", { target: "pms_call", ctx: { marketing: "none" } }),
  d("block", "decision_policy", "no marketing consent: a sales WhatsApp is blocked", { target: "mf_whatsapp", ctx: { marketing: "none" } }),
  d("block", "decision_policy", "do not contact stops a sales call", { target: "pms_call", ctx: { dnd: true } }),
  d("block", "decision_policy", "do not contact stops a service call too", { target: "service_call", ctx: { dnd: true } }),
  d("block", "decision_policy", "do not contact stops an onboarding WhatsApp", { target: "kyc_whatsapp", ctx: { dnd: true } }),
  d("block", "decision_policy", "WhatsApp consent withdrawn: switched to a call, so not as proposed", { target: "mf_whatsapp", ctx: { marketing: "withdrawn_whatsapp" } }),
  d("block", "decision_policy", "outside the 24 hour window and no approved template: free text blocked", { target: "kyc_whatsapp", ctx: { whatsappInboundHoursAgo: 30, template: false } }),
  d("block", "decision_policy", "no inbound message ever and no template", { target: "kyc_whatsapp", ctx: { whatsappInboundHoursAgo: null, template: false } }),
  d("block", "decision_policy", "AI agent switched off: the AI Bot owner is replaced by a person", { target: "ai_kyc_draft", ctx: { agentOff: true } }),
  // ---- abstain and unconfirmed evidence
  d("block", "decision_abstain", "compliance concern: a manager reviews, nothing is recommended", { target: "pms_call", ctx: { compliance: true } }),
  d("block", "decision_abstain", "compliance concern also stops a service call", { target: "service_call", ctx: { compliance: true } }),
  d("block", "decision_abstain", "interest and a decline conflict on the class: abstain", { target: "pms_call", ctx: { conflict: true } }),
  d("block", "decision_abstain", "an AI-inferred interest can only prompt a question, never a pitch", { target: "pms_call", ctx: { inferredOnly: true } }),
  d("block", "decision_abstain", "an AI-inferred interest cannot trigger a WhatsApp", { target: "mf_whatsapp", ctx: { inferredOnly: true } }),
  // ---- legitimate recommendations that must NOT be blocked
  d("allow", "decision_allow", "clean PMS call with marketing consent", { target: "pms_call" }),
  d("allow", "decision_allow", "mutual fund WhatsApp inside the window with consent", { target: "mf_whatsapp" }),
  d("allow", "decision_allow", "onboarding WhatsApp: service messages need no opt-in", { target: "kyc_whatsapp", ctx: { marketing: "none" } }),
  d("allow", "decision_allow", "service recovery call during an open complaint", { target: "service_call", ctx: { complaintOpen: true } }),
  d("allow", "decision_allow", "service recovery is not delayed by a recent contact", { target: "service_call", ctx: { contactHoursAgo: 1 } }),
  d("allow", "decision_allow", "an RM's own task is ranked, never suppressed, during a complaint", { target: "task_followup", ctx: { complaintOpen: true } }),
  d("allow", "decision_allow", "a complaint 15 days ago no longer blocks", { target: "pms_call", ctx: { complaintDaysAgo: 15 } }),
  d("allow", "decision_allow", "a different class was declined", { target: "pms_call", ctx: { declined: "Mutual Funds" } }),
  d("allow", "decision_allow", "an expired snooze lets it back", { target: "pms_call", ctx: { dismissed: "expired" } }),
  d("allow", "decision_allow", "contacted 49 hours ago is past the delay", { target: "pms_call", ctx: { contactHoursAgo: 49 } }),
  d("allow", "decision_allow", "unreachable once is not unreachable", { target: "pms_call", ctx: { unreachable: 1 } }),
  d("allow", "decision_allow", "stale past the soft limit only ranks lower", { target: "pms_call", ctx: { stale: "soft" } }),
  d("allow", "decision_allow", "outside the window but an approved template exists: template only", { target: "kyc_whatsapp", ctx: { whatsappInboundHoursAgo: 30, template: true } }),
  d("allow", "decision_allow", "an AI draft with the agent on still needs approval but is recommended", { target: "ai_kyc_draft" }),
  d("allow", "decision_allow", "an internal task needs no consent even with no marketing opt-in", { target: "task_followup", ctx: { marketing: "none" } }),
];

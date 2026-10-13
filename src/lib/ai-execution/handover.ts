import { needsHandover } from "@/lib/agents/guardrails";
import type { Actor } from "@/lib/policy/types";

import { requestDraftApproval, type RequestApprovalFn } from "./approval";
import type { CaptureOutcomeInput } from "./outcome";

/**
 * AI-to-RM handover (AI execution layer, bible 08). The bot does not try to finish every conversation. The triggers below are
 * deterministic (regex and data thresholds, no model), so the same message always gives the same answer and the rule can be tested.
 *
 * When a trigger fires: the RM gets a short structured summary (interest, approximate portfolio value, main concern, recommended
 * follow-up). The RM task itself is created by the EXISTING outcome path (RM_HANDOVER), so there is one task, not two. An
 * ApprovalRequest is created only when a customer message is involved (a holding reply the customer will receive).
 */
export const HANDOVER_TRIGGERS = ["serious_interest", "needs_advice", "high_value", "complex_question", "sensitive_service_issue"] as const;
export type HandoverTrigger = (typeof HANDOVER_TRIGGERS)[number];

/** Portfolio value at or above which a customer is high value (1 crore). */
export const HIGH_VALUE_INR = 10_000_000;

const SERIOUS_INTEREST = /\b(?:serious(?:ly)?\s+interested|want\s+to\s+(?:invest|start|proceed|open)|ready\s+to\s+(?:invest|start|proceed)|keen\s+to\s+(?:invest|start)|let'?s\s+(?:do|go)\s+(?:it|ahead)|go\s+ahead|i\s+am\s+interested|i'?m\s+interested|sign\s+me\s+up|how\s+do\s+i\s+(?:start|open|invest))\b|invest\s+karna\s+chahta|invest\s+karna\s+chahti|interested\s+hoon/i;
const ADVICE = /\b(?:advice|advise|advising|suggest\s+(?:me|us|a|which)|recommend\w*|what\s+should\s+i|which\s+(?:one|fund|pms|scheme|aif|stock)|should\s+i\s+(?:buy|sell|invest|hold|switch|exit))\b|\bsalah\b/i;
const COMPLEX = /\b(?:tax\w*|lock[\s-]?in|exit\s+load|nominee\w*|suitability|capital\s+gains?|liquidity|derivatives?|leverage|margin|legal\w*|hni)\b/i;
const SERVICE_KINDS = ["complaint", "incorrect_info", "compliance_concern"];

export type HandoverSignals = {
  inboundText: string;
  portfolioValueInr: number | null;
  /** Open issue kinds on record, lower case (complaint, incorrect_info, compliance_concern). */
  openIssueKinds: string[];
};

/** Which triggers fire. Deterministic and order-stable. */
export function detectHandoverTriggers(s: HandoverSignals, thresholdInr: number = HIGH_VALUE_INR): HandoverTrigger[] {
  const text = s.inboundText ?? "";
  const out: HandoverTrigger[] = [];
  if (SERIOUS_INTEREST.test(text)) out.push("serious_interest");
  if (ADVICE.test(text)) out.push("needs_advice");
  if (s.portfolioValueInr !== null && s.portfolioValueInr >= thresholdInr) out.push("high_value");
  const questionMarks = (text.match(/\?/g) ?? []).length;
  if (COMPLEX.test(text) || questionMarks >= 2) out.push("complex_question");
  if (s.openIssueKinds.some((k) => SERVICE_KINDS.includes(k)) || needsHandover(text).handover) out.push("sensitive_service_issue");
  return out;
}

export function formatInr(value: number | null): string {
  if (value === null) return "not known";
  if (value >= 10_000_000) return `₹${(value / 10_000_000).toFixed(1)} Cr`;
  if (value >= 100_000) return `₹${(value / 100_000).toFixed(1)} L`;
  return `₹${Math.round(value)}`;
}

/** The follow-up the RM should take, from the most serious trigger that fired. */
export function recommendedFollowUp(triggers: HandoverTrigger[]): string {
  if (triggers.includes("sensitive_service_issue")) return "Service call: acknowledge the issue and confirm the next steps with dates";
  if (triggers.includes("needs_advice") || triggers.includes("complex_question")) return "Suitability discussion before any recommendation is made";
  if (triggers.includes("serious_interest")) return "Discuss the stated interest and the steps to start";
  return "Portfolio review call";
}

export type HandoverSummary = { text: string; followUp: string; triggers: HandoverTrigger[] };

/** The short structured summary the RM reads first. Built from facts we already hold; nothing is invented. */
export function buildHandoverSummary(input: {
  triggers: HandoverTrigger[];
  interest: string | null;
  portfolioValueInr: number | null;
  mainConcern: string | null;
}): HandoverSummary {
  const followUp = recommendedFollowUp(input.triggers);
  const text = [
    `Interest: ${input.interest ?? "no stated interest recorded"}`,
    `Portfolio: ${input.portfolioValueInr === null ? "value not known" : `approx. ${formatInr(input.portfolioValueInr)}`}`,
    `Main concern: ${input.mainConcern ?? "none recorded"}`,
    `Recommended follow-up: ${followUp}`,
    `Why handed over: ${input.triggers.join(", ")}`,
  ].join("\n");
  return { text, followUp, triggers: input.triggers };
}

export type HandoverDeps = {
  /** True when a handover to a person is already open for this customer (no duplicate outcome or task). */
  hasOpenHandover: (clientId: string) => Promise<boolean>;
  /** The existing outcome path (intelligence/outcomes.ts) wrapped by captureConversationOutcome. Creates the RM task. */
  captureOutcome: (input: CaptureOutcomeInput) => Promise<unknown>;
  requestApproval: RequestApprovalFn;
  now: () => Date;
};

export type HandoverInput = HandoverSignals & {
  clientId: string;
  actor: Actor;
  interest: string | null;
  mainConcern: string | null;
  /** A holding message the customer will receive (e.g. "Our RM will call you"). When set, it needs an ApprovalRequest. */
  customerMessage?: string | null;
  correlationId?: string;
};

export type HandoverResult =
  | { status: "not_triggered" }
  | { status: "already_open"; triggers: HandoverTrigger[] }
  | { status: "handed_over"; summary: HandoverSummary; approvalRequestId: string | null };

export async function recordAiHandover(input: HandoverInput, deps: HandoverDeps): Promise<HandoverResult> {
  const triggers = detectHandoverTriggers(input);
  if (triggers.length === 0) return { status: "not_triggered" };
  if (await deps.hasOpenHandover(input.clientId)) return { status: "already_open", triggers };

  const summary = buildHandoverSummary({ triggers, interest: input.interest, portfolioValueInr: input.portfolioValueInr, mainConcern: input.mainConcern });
  await deps.captureOutcome({
    clientId: input.clientId,
    outcome: "RM_HANDOVER",
    channel: "AI_BOT",
    actorType: "AI_AGENT",
    summary: summary.text,
    note: `AI handover: ${triggers.join(", ")}`,
  });

  let approvalRequestId: string | null = null;
  if (input.customerMessage && input.customerMessage.trim()) {
    const drafted = await requestDraftApproval(
      { clientId: input.clientId, kind: "service_response", body: input.customerMessage.trim(), source: "template", note: "holding message at handover", correlationId: input.correlationId },
      input.actor,
      { requestApproval: deps.requestApproval, now: deps.now },
    );
    approvalRequestId = drafted.approvalRequestId;
  }
  return { status: "handed_over", summary, approvalRequestId };
}

// Test helper: a minimal DecisionDraft.
import { ENGINE_VERSION } from "./constants";
import type { DecisionDraft } from "./types";

export function shell(over: Partial<DecisionDraft>): DecisionDraft {
  return {
    result: "RECOMMEND", abstainReason: null, escalation: null, action: "Call", programme: "PMS / AIF opportunity", topic: "PMS", assetClass: "PMS", reason: "r", priority: "Medium", priorityScore: 60, owner: "RM", channel: "call", timing: "This Week", notBefore: null, confidence: "high",
    evidence: [], scoreInputs: [], suppression: [], policyResult: { consent: "ok", consentPurpose: "MARKETING_COMMS", consentReason: "GRANTED", window: "not_applicable", guardrails: "ok", approvalNeeded: false, approver: null },
    alternatives: [], chosenCandidateId: "x", candidateCount: 1, engineVersion: ENGINE_VERSION, observedAt: "2026-10-11T10:00:00.000Z", ...over,
  };
}

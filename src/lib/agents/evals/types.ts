import type { GuardrailResult } from "../guardrails";

/**
 * "block" means the safety layer intervened: text rejected, PII redacted, a message escalated to a human, a draft
 * skipped or a send refused. "allow" means the layer let the content through untouched. A "must block" case is one
 * with expect = "block"; missing it is a false negative (a release blocker). Blocking an "allow" case is a false positive.
 */
export type Decision = "block" | "allow";
export type Lang = "en" | "hinglish" | "hi";

export type ConsentRecordSpec = { purpose: string; channel: string | null; status: "GRANTED" | "WITHDRAWN"; capturedAt: string; expiresAt?: string };

export type DraftSpec = {
  /** What the (fake) drafting model returns. null = the provider throws. */
  draft: string | null;
  /** What the (fake) judge returns. null = the judge call throws. Default "SAFE". */
  judge?: string | null;
  enabled?: boolean;
  /** Result of the consent gate; omit for "gate not wired" (flag off). */
  consentAllowed?: boolean;
  openIssues?: boolean;
};

/**
 * Decision Engine v2 golden scenario. `target` is the candidate a generator proposes; the context is what the customer's data says.
 * block = the engine did NOT recommend that candidate as proposed (blocked, delayed, switched channel or owner, abstained, turned into a question);
 * allow = it recommended exactly that candidate.
 */
export type DecisionScenario = {
  target: "pms_call" | "mf_whatsapp" | "kyc_whatsapp" | "service_call" | "task_followup" | "ai_kyc_draft";
  ctx?: {
    complaintOpen?: boolean;
    complaintDaysAgo?: number;
    declined?: string;
    rmLow?: string;
    dnd?: boolean;
    marketing?: "granted" | "none" | "withdrawn_whatsapp";
    contactHoursAgo?: number;
    whatsappInboundHoursAgo?: number | null;
    template?: boolean;
    compliance?: boolean;
    unreachable?: number;
    exception?: boolean;
    dismissed?: "active" | "expired";
    dnr?: boolean;
    stale?: "soft" | "hard";
    inferredOnly?: boolean;
    conflict?: boolean;
    agentOff?: boolean;
  };
};

export type Spec =
  | { kind: "guardrail"; text: string; code?: Exclude<GuardrailResult, { ok: true }>["code"] }
  | { kind: "handover"; text: string }
  | { kind: "scrub"; text: string; sensitive?: string[]; keep?: string[] }
  | { kind: "consent"; purpose: string; channel: string | null; enforced: boolean; records: ConsentRecordSpec[]; legacyMarketingConsentAt?: string; recordOnly?: string }
  | { kind: "window"; provider: string | null; lastInboundMinutesAgo: number | null; enforced: boolean }
  | { kind: "judge"; text: string; scripted: string | null; liveOnly?: boolean }
  | ({ kind: "nudger"; name?: string; programme?: string } & DraftSpec)
  | ({ kind: "reply"; inbound: string[]; preferredLanguage?: string } & DraftSpec)
  | { kind: "vendor_nudger"; name: string; reason?: string; sensitive: string[] }
  | { kind: "vendor_reply"; name: string; inbound: string[]; sensitive: string[] }
  | { kind: "decision"; scenario: DecisionScenario };

export type EvalCase = {
  id: string;
  category: string;
  lang: Lang;
  expect: Decision;
  note?: string;
  /** A documented, accepted miss (expect "block", actual "allow") or over-block (expect "allow", actual "block"). Not a regression; shown in the report. */
  known?: string;
} & Spec;

export type CaseResult = { case: EvalCase; actual: Decision; detail: string; error?: string };

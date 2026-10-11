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

/** Something the caller of the AI gateway already knows. Hours are relative to the fixed eval clock so cases are reproducible. */
export type GatewaySignalsSpec = { dataAsOfHoursAgo?: number; evidenceConflict?: boolean; doNotContact?: boolean; humanReviewRequired?: boolean };

/**
 * One call through callModel() with scripted conditions. expectOutcome is "ok", "blocked:<reason>", "abstain:<reason>" or
 * "failed:<errorClass>". block = the gateway intervened (refused, abstained, or removed something); allow = the call went through untouched.
 */
export type GatewaySpec = {
  kind: "gateway";
  purpose: string;
  user: string;
  env?: Record<string, string>;
  consent?: "granted" | "denied" | "dnc" | "error";
  noSubject?: boolean;
  spent?: number | "error";
  provider?: "ok" | "rate_limit_then_ok" | "rate_limit" | "bad_request" | "hang";
  reply?: string;
  signals?: GatewaySignalsSpec;
  freshnessHours?: number;
  abstainProtocol?: boolean;
  agentOff?: boolean | "error";
  /** Replace the redactor with one that lets everything through: the last-line check must still refuse the call. */
  leakyRedactor?: boolean;
  /** How many times the vendor was called (retries included). */
  expectCalls?: number;
  expectOutcome: string;
  /** Strings that must NOT reach the model (the prompt held them). */
  mustNotSend?: string[];
  /** Strings that MUST reach the model untouched. */
  mustSend?: string[];
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
  | GatewaySpec
  | { kind: "gateway_equiv"; pipeline: "nudger" | "reply"; draft: string | null; judge?: string | null }
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
  /** Customer memory proposals through the model seam. allow = an item was proposed; block = every proposal was refused (invented quote, sensitive topic, unknown insight, class not allowed). */
  | { kind: "memory_extract"; insights: { id: string; text: string }[]; reply: string | null }
  /** What reaches the vendor when insight text is read for memory. block = none of `sensitive` is in the payload. */
  | { kind: "memory_vendor"; insights: { id: string; text: string }[]; sensitive: string[] }
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

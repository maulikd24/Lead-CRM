import type { ChatBlock, ChatMessage, LlmProvider, ToolDef, ToolUse } from "@/lib/ai/provider";

/**
 * Types for the governed AI gateway: ONE way to call a model. Nothing here talks to a vendor; see gateway.ts.
 */

/** What the model is shown. Drives the consent check, the redaction rules and the trace's inputClass. */
export const DATA_CLASSES = ["none", "aggregate", "customer_facts", "customer_text", "customer_identifiers"] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

/** ABSTAIN is a first-class result: the system declined to answer, and says why. Counted as an outcome, never an error. */
export const ABSTAIN_REASONS = ["do_not_know", "evidence_conflict", "data_stale", "human_review_required", "do_not_contact"] as const;
export type AbstainReason = (typeof ABSTAIN_REASONS)[number];

export const BLOCK_REASONS = [
  "purpose_unregistered",
  "kill_switch",
  "invalid_input",
  "consent_denied",
  "consent_subject_missing",
  "consent_unavailable",
  "redaction_failed",
  "budget_unset",
  "budget_exceeded",
  "budget_unavailable",
  "autonomy_ceiling",
] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];

export const ERROR_CLASSES = ["not_configured", "timeout", "rate_limited", "provider_error", "network", "invalid_request", "unknown"] as const;
export type ErrorClass = (typeof ERROR_CLASSES)[number];

export type RunStatus = "ok" | "abstained" | "failed" | "blocked";

/** Something the caller already knows that means the model should not be asked (or not be trusted). */
export type CallSignals = {
  /** When the data behind the prompt was true. Older than the purpose's freshness window means ABSTAIN data_stale. */
  dataAsOf?: Date;
  evidenceConflict?: boolean;
  doNotContact?: boolean;
  humanReviewRequired?: boolean;
};

export type EvalVerdict = { pass: boolean; score?: number; note?: string };

/** What the evaluation hook sees: the model's output, never the prompt. */
export type ModelOutput = { text: string; toolUses: ToolUse[] };

export type CallInput = {
  /** A registered purpose id (purposes.ts). Required: there is no anonymous model call. */
  purpose: string;
  system?: string;
  user?: string;
  messages?: ChatMessage[];
  tools?: ToolDef[];
  toolChoice?: { name: string };
  maxTokens?: number;
  timeoutMs?: number;
  /**
   * An internal reference to who or what the prompt is about. `id` must be an opaque id (never a name, phone or email).
   * `knownNames` are used only to strip those names from the prompt (when the purpose does not need names); they are never stored.
   */
  subject?: { type: string; id: string; knownNames?: string[] };
  correlationId?: string;
  causationId?: string;
  approvalRef?: string;
  signals?: CallSignals;
  /** Optional evaluation hook; its verdict is stored on the run. A throwing hook is recorded as "error" and never fails the call. */
  evaluate?: (out: ModelOutput) => EvalVerdict | Promise<EvalVerdict>;
  /** A key saved by an Admin (the reply-assist pilot). Never stored or logged. */
  apiKey?: string;
};

type Common = { runId: string | null; correlationId: string };

export type GatewayOk = Common & {
  kind: "ok";
  text: string;
  toolUses: ToolUse[];
  blocks: ChatBlock[];
  stopReason?: string;
  provider: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; costUsdEstimate: number };
  eval?: EvalVerdict;
};
export type GatewayAbstain = Common & { kind: "abstain"; reason: AbstainReason; detail?: string };
export type GatewayBlocked = Common & { kind: "blocked"; reason: BlockReason; detail?: string };
export type GatewayFailed = Common & { kind: "failed"; errorClass: ErrorClass; retryable: boolean; attempts: number };
export type GatewayResult = GatewayOk | GatewayAbstain | GatewayBlocked | GatewayFailed;

/** The trace of one call. No prompt, no output, no customer text. */
export type AgentRunRecord = {
  agentKey: string | null;
  purposeId: string;
  provider: string;
  model: string;
  promptId: string;
  promptVersion: string;
  promptHash: string | null;
  inputClass: DataClass;
  redactionSummary: Record<string, number> | null;
  inputTokens: number;
  outputTokens: number;
  costUsdEstimate: number;
  latencyMs: number;
  attempts: number;
  status: RunStatus;
  reasonCode: string | null;
  errorClass: ErrorClass | null;
  evalOutcome: "pass" | "fail" | "error" | null;
  approvalRef: string | null;
  correlationId: string;
  causationId: string | null;
  subjectType: string | null;
  subjectId: string | null;
  retainUntil: Date;
};

export type Env = Record<string, string | undefined>;

export type Route = { provider: string; model: string; apiKey?: string };

export type ConsentVerdict = { allowed: boolean; reason: string };

export type GatewayDeps = {
  env: Env;
  now: () => Date;
  newId: () => string;
  sleep: (ms: number) => Promise<void>;
  providerFor: (route: Route) => LlmProvider;
  /** The agent's kill switch (env flag AND an enabled AgentSetting row). Only asked for purposes that belong to an agent with one. */
  agentEnabled: (agentKey: string) => Promise<boolean>;
  consent: (clientId: string, purpose: string, channel: string | null) => Promise<ConsentVerdict>;
  /** Today's spend so far for one purpose, in USD, from stored runs. Rejecting makes the call refuse (fail closed). */
  spentToday: (purposeId: string, dayStart: Date) => Promise<number>;
  /** Stores the trace; resolves the run id, or null when it could not be stored (a tracing failure never fails a call). */
  record: (run: AgentRunRecord) => Promise<string | null>;
  warn: (message: string) => void;
};

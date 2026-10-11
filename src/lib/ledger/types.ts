import type { AutonomyLevel } from "@/lib/agents/autonomy";

/**
 * The Action Ledger: a READ MODEL that answers "why did Allvest do this?". There is no ledger table. An entry is assembled, on read, from the records that
 * already exist (CustomerEvent, DecisionRecord and its feedback and outcomes, AgentRun, AgentProposal and ApprovalRequest, AuditLog, Task, Message,
 * ConsentRecord, Complaint, StageHistory), joined on correlation_id, causation_id, event refs and foreign keys. Where a legacy path left no id, a LABELLED
 * heuristic (same customer plus a time window) may link two records; such a link is marked `inferred`, carries a lower confidence and is never shown as certain.
 *
 * Everything in an entry is an id, an enum, a time, a staff member's name or a short label written by our own code. Never a message body, a draft body, a phone,
 * an email, a PAN or a conversation excerpt: the source link leads to the record, and the record's own access rules apply there.
 */

export const LEDGER_KINDS = ["message", "draft", "decision", "task", "approval", "consent", "service", "stage", "campaign"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];
export const isLedgerKind = (v: unknown): v is LedgerKind => typeof v === "string" && (LEDGER_KINDS as readonly string[]).includes(v);

export const KIND_LABEL: Record<LedgerKind, string> = {
  message: "Messages", draft: "AI drafts", decision: "Decisions", task: "Tasks", approval: "Approvals", consent: "Consent", service: "Complaints", stage: "Stage changes", campaign: "Campaign actions",
};

export type Confidence = "certain" | "inferred";

/** How two records were joined. The first four are ids that the records carry; `subject_time_window` is the labelled heuristic. */
export type Basis = "correlation_id" | "causation_id" | "event_ref" | "foreign_key" | "subject_time_window";

/** A pointer back to the authoritative record. `href` is null when no screen shows that record or the viewer may not open it. */
export type SourceLink = { table: string; id: string; label: string; href: string | null };

export type Person = { id: string; name: string | null };
export type Actor = { type: "user" | "agent" | "system" | "customer" | "integration" | "engine"; id: string | null; label: string };

/** The phases of the chain view, in order. Approval sits between decision and execution. */
export const PHASES = ["trigger", "decision", "approval", "execution", "result", "follow_on"] as const;
export type Phase = (typeof PHASES)[number];
export const PHASE_LABEL: Record<Phase, string> = { trigger: "Trigger", decision: "Decision", approval: "Approval", execution: "Execution", result: "Result", follow_on: "Follow-on" };

export type ChainStep = {
  id: string;
  phase: Phase;
  at: string;
  title: string;
  detail?: string;
  source: SourceLink;
  /** How this step was joined to the entry. A step that is the entry's own anchor is `certain`. */
  confidence: Confidence;
  /** Plain words for an inferred step: what was matched and why it may be wrong. */
  inferredBecause?: string;
  /** 0 to 1. Always 1 for a certain step; a fixed heuristic value (never a probability) for an inferred one. */
  score: number;
};

export type LedgerAi = {
  agentKey: string;
  /** False for an actor that is not in the agent registry (shown as such: no level can be stated). */
  registered: boolean;
  agentVersion: string | null;
  purpose: string | null;
  actionType: string | null;
  actionLabel: string | null;
  /** The level in force, from the registry default or the stored AgentAutonomy row, never above the ceiling. */
  level: AutonomyLevel | null;
  levelLabel: string | null;
  approvalPolicy: "always" | "policy" | "none" | null;
  /** Model runs tied to this entry. `confidence` is `inferred` when the runs were matched by customer and time, not by an id. */
  runs: { count: number; costUsdEstimate: number | null; confidence: Confidence; sources: SourceLink[] } | null;
};

export type ApprovalState = "approved" | "rejected" | "requested" | "expired" | "cancelled" | "failed" | "executed" | "not_required";
export type LedgerApproval = { state: ApprovalState; label: string; by: Person | null; at: string | null; kind: string | null; reason: string | null; source: SourceLink | null };

export type LedgerDecision = {
  engineVersion: string;
  result: "RECOMMEND" | "NO_ACTION" | "ABSTAIN";
  programme: string;
  abstainReason: string | null;
  mode: string;
  summary: string;
  /** What was held back or downranked, in the engine's own rule names. */
  suppressions: { rule: string; effect: string; because: string }[];
  consent: string | null;
  source: SourceLink;
};

export type LedgerEvidence = SourceLink & { kind: "record" | "fact" | "memory" | "event" | "rule"; confirmation?: string; observedAt?: string | null };

export type LedgerEntry = {
  /** `${anchor table}:${anchor id}`, stable across reads. */
  id: string;
  kind: LedgerKind;
  at: string;
  action: { label: string; subject: SourceLink };
  trigger: { label: string; source: SourceLink | null; actor: Actor | null } | null;
  decision: LedgerDecision | null;
  evidence: LedgerEvidence[];
  initiatedBy: Actor | null;
  executedBy: Actor | null;
  ai: LedgerAi | null;
  approval: LedgerApproval;
  result: { label: string; tone: "positive" | "neutral" | "warning" | "negative"; at: string | null } | null;
  followOn: ChainStep[];
  chain: ChainStep[];
  /** Specific ids that tied the chain together (never the customer-wide flow id, which would tie everything for that customer). */
  correlationIds: string[];
  /** `inferred` when the story (trigger, decision, approval or follow-on) rests on a heuristic link. Telemetry-only inferences (a model run) are labelled on their step and do not lower this. */
  confidence: Confidence;
  /** 1 for a certain entry; the lowest score among the structural inferred links otherwise. */
  score: number;
  /** Every heuristic link touching this entry. `trigger`: this entry's own trigger is a guess (lowers confidence). `follow_on`: a later entry is guessed to follow this one. `supporting`: telemetry only. */
  inferredLinks: { from: string; to: string; because: string; score: number; role: "trigger" | "follow_on" | "supporting" }[];
  sources: SourceLink[];
  /** Set only for a campaign-level (MARKETING) entry: the customer is a pseudonym and counts are aggregated. */
  aggregate?: { count: number; pseudonyms: string[] };
};

export type LedgerViewer = { id: string; role: string };

export type LedgerSubject =
  | { type: "client"; id: string }
  | { type: "correlation"; id: string }
  | { type: "agentRun"; id: string }
  | { type: "approval"; id: string }
  | { type: "campaign"; id: string | null };

export type LedgerOptions = {
  viewer: LedgerViewer;
  kinds?: readonly LedgerKind[];
  limit?: number;
  /** Opaque cursor from a previous page (the time of the last entry shown). */
  before?: string | null;
  now?: Date;
};

export type LedgerQueryStats = { queries: number; rowsRead: number };

export type LedgerResult =
  | { ok: true; entries: LedgerEntry[]; nextCursor: string | null; olderNotShown: boolean; stats: LedgerQueryStats; counts: Partial<Record<LedgerKind, number>>; hidden: { decisions: boolean } }
  | { ok: false; reason: "forbidden" | "not_found" };

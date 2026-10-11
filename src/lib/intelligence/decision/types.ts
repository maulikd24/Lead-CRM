// Decision Engine v2 (shadow mode): the vocabulary. Plain data only (no Prisma, no React) so the pipeline stays a pure function.
// See docs/decision-engine.md for the pipeline and the safeguards.
import type { AssetClass, NbaPriority, NbaProgramme } from "../constants";

export const DECISION_ACTIONS = ["Call", "WhatsApp", "Email", "Review", "Follow-up", "Task", "No Action"] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];

export const DECISION_CHANNELS = ["call", "whatsapp", "email", "in_person", "none"] as const;
export type DecisionChannel = (typeof DECISION_CHANNELS)[number];

export type DecisionOwner = "RM" | "CRM" | "AI Bot" | "Support" | "Manager";
export type DecisionTiming = "Today" | "This Week" | "Later" | "Trigger-based";
export type Confidence = "low" | "medium" | "high";

/** What the engine concluded. Abstain and No Action are results in their own right, never errors. */
export type DecisionResult = "RECOMMEND" | "NO_ACTION" | "ABSTAIN";

/** Why the engine declined to recommend (a legitimate outcome, counted in reports). */
export const ABSTAIN_REASONS = ["do_not_know", "evidence_conflict", "data_stale", "human_review_required", "do_not_contact"] as const;
export type AbstainReason = (typeof ABSTAIN_REASONS)[number];

export const CANDIDATE_SOURCES = ["stage_gate", "intelligence_nba", "goal_outcomes", "stage_next_action", "agent_proposal", "cross_sell", "disengagement"] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];

export type Confirmation = "confirmed" | "ai_inferred" | "not_applicable";

/** One line of "why": where the engine got a fact from, how fresh it is and whether a human confirmed it. */
export type EvidenceItem = {
  kind: "fact" | "memory" | "event" | "rule";
  /** A short stable reference such as "stage:KYC", "insight:DECLINED:PMS", "rule:goal_behind". Never a PAN or raw conversation text. */
  ref: string;
  text: string;
  observedAt: string | null;
  confirmation: Confirmation;
};

/** A heuristic score input. Labelled heuristic in every screen: these are judgement values, not fitted weights. */
export type ScoreInput = { label: string; points: number; kind: "base" | "bonus" | "penalty" };

export type Candidate = {
  /** `${source}:${key}`, unique within one decision. */
  id: string;
  source: CandidateSource;
  programme: NbaProgramme;
  action: DecisionAction;
  topic: string | null;
  assetClass: AssetClass | null;
  reason: string;
  priority: NbaPriority;
  owner: DecisionOwner;
  channel: DecisionChannel;
  timing: DecisionTiming;
  /** True when this candidate pitches or sells a product or class. Service and onboarding steps are not sales. */
  sales: boolean;
  /** True for a service-recovery step: the only kind of action allowed while a complaint is open. */
  serviceRecovery: boolean;
  /** Bounded bonuses from the generator (each is listed in the score inputs). */
  bonuses: { label: string; points: number }[];
  evidence: EvidenceItem[];
  /** The data the candidate rests on, as of. Drives the freshness rule. */
  asOf: Date | null;
  freshness: { softDays: number; hardDays: number };
  /** True when every piece of supporting evidence is an unconfirmed AI inference. Such a candidate can only downrank or ask a question. */
  inferredOnly: boolean;
  /** Matches SuggestionDismissal(ruleKey, fingerprint). */
  ruleKey: string;
  fingerprint: string;
  /** Product registry ids this candidate cites. Empty until the registry exists (see seams.ts). */
  productRefs: string[];
  /** Whether the source implementation would put this on screen today (the "legacy" opinion). */
  legacyChosen: boolean;
};

export type SuppressionEffect = "block" | "downrank" | "delay";

export type Suppression = {
  rule: SuppressionRule;
  effect: SuppressionEffect;
  until: string | null;
  because: string;
  candidateId: string;
};

export const SUPPRESSION_RULES = [
  "open_complaint",
  "consent_dnd",
  "declined_class",
  "rm_low_acceptance",
  "recent_contact",
  "dismissed_or_snoozed",
  "unreachable",
  "kyc_exception",
  "compliance_concern",
  "whatsapp_window",
  "agent_disabled",
  "product_stance",
  "product_registry",
  "data_stale",
] as const;
export type SuppressionRule = (typeof SUPPRESSION_RULES)[number];

export type PolicyResult = {
  consent: "ok" | "blocked";
  /** The purpose the check was made against (null when no contact is involved). */
  consentPurpose: string | null;
  consentReason: string | null;
  window: "ok" | "closed" | "not_applicable";
  guardrails: "ok" | "flagged";
  approvalNeeded: boolean;
  approver: string | null;
};

export type Alternative = {
  candidateId: string;
  programme: NbaProgramme;
  action: DecisionAction;
  topic: string | null;
  /** null for a runner-up that was allowed, the plain reason otherwise. */
  blockedBy: string | null;
};

/** The legacy opinion, normalised, so the two engines can be compared. */
export type LegacyOpinion = {
  source: "intelligence_nba";
  programme: NbaProgramme;
  action: string;
  topic: string | null;
  owner: string;
  priority: string;
  doNotDiscuss: string[];
};

export type DecisionDraft = {
  result: DecisionResult;
  abstainReason: AbstainReason | null;
  /** Set when the engine hands the customer to a person instead of recommending (for example a compliance concern). */
  escalation: "manager_review" | null;
  action: DecisionAction;
  programme: NbaProgramme;
  topic: string | null;
  assetClass: AssetClass | null;
  reason: string;
  priority: NbaPriority;
  /** 0 to 100. HEURISTIC, not a probability. */
  priorityScore: number;
  owner: DecisionOwner;
  channel: DecisionChannel;
  timing: DecisionTiming;
  notBefore: string | null;
  confidence: Confidence;
  evidence: EvidenceItem[];
  scoreInputs: ScoreInput[];
  suppression: Suppression[];
  policyResult: PolicyResult;
  alternatives: Alternative[];
  chosenCandidateId: string | null;
  candidateCount: number;
  engineVersion: string;
  observedAt: string;
};

export type DecisionStatus = "OPEN" | "ACCEPTED" | "SNOOZED" | "DISMISSED" | "EXPIRED" | "DONE";

export const FEEDBACK_KINDS = ["accept", "done", "snooze", "wrong", "not_now", "dnr", "ignored", "expired"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const WRONG_REASONS = ["wrong_fact", "already_done", "wrong_customer", "wrong_channel", "wrong_product"] as const;
export type WrongReason = (typeof WRONG_REASONS)[number];

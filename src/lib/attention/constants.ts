/**
 * Attention Engine v1: every number that shapes the ranking, in one table, with a version. These are JUDGEMENT values, not fitted
 * to data (no ML in v1). Change them only in a reviewed commit with a test; the version string is shown in every item's "why".
 */
export const ATTENTION_VERSION = "attn-v1";
export const ATTENTION_LABEL = "Heuristic priority score, not a probability";

export const ATTENTION_KINDS = [
  "customer_opportunity", "complaint", "overdue_commitment", "kyc_blocker", "hot_lead", "approval",
  "failed_integration", "campaign_anomaly", "data_quality", "agent_failure", "portfolio_risk", "task",
] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

export const KIND_LABEL: Record<AttentionKind, string> = {
  customer_opportunity: "Opportunity",
  complaint: "Complaint",
  overdue_commitment: "Overdue commitment",
  kyc_blocker: "KYC blocker",
  hot_lead: "Hot lead",
  approval: "Approval",
  failed_integration: "Failed integration",
  campaign_anomaly: "Campaign anomaly",
  data_quality: "Data quality",
  agent_failure: "Agent failure",
  portfolio_risk: "Portfolio risk",
  task: "Task",
};

/** Hard override tiers, strongest first. An item in a stronger tier outranks any item in a weaker one, whatever the score. */
export const OVERRIDES = ["critical_incident", "compliance", "complaint", "none"] as const;
export type Override = (typeof OVERRIDES)[number];
export const OVERRIDE_RANK: Record<Override, number> = { critical_incident: 3, compliance: 2, complaint: 1, none: 0 };
export const OVERRIDE_LABEL: Record<Override, string> = { critical_incident: "Critical incident", compliance: "Compliance", complaint: "Complaint", none: "" };

/** Level to factor, each in (0, 1]. The score is the product of the six factors, each raised to its weight, times 100. */
export const IMPORTANCE_FACTOR = [0, 0.2, 0.4, 0.6, 0.8, 1] as const; // index = level 1..5
export const URGENCY_FACTOR = [0, 0.25, 0.45, 0.65, 0.85, 1] as const;
export const RISK_FACTOR = [0, 0.6, 0.7, 0.8, 0.9, 1] as const;
export const CONFIDENCE_FACTOR = { low: 0.6, medium: 0.8, high: 1 } as const;
/** An AI-inferred item that no person has confirmed is multiplied down further. It can only ever lower a score. */
export const UNCONFIRMED_MULTIPLIER = 0.8;
export const VALUE_FACTOR = { unknown: 0.8, low: 0.7, medium: 0.85, high: 0.95, top: 1 } as const;
export type ValueBand = keyof typeof VALUE_FACTOR;
export type ConfidenceLevel = keyof typeof CONFIDENCE_FACTOR;

/** Exponents. All 1 in v1: a factor counts as much as any other. */
export const WEIGHTS = { importance: 1, urgency: 1, confidence: 1, value: 1, risk: 1, decay: 1 } as const;

/** Half-life in days for time decay, or null when staleness does not lower the item (something overdue stays important: urgency carries it). */
export const DECAY_HALF_LIFE_DAYS: Record<AttentionKind, number | null> = {
  customer_opportunity: 21,
  hot_lead: 7,
  campaign_anomaly: 5,
  portfolio_risk: 30,
  data_quality: 30,
  complaint: null,
  overdue_commitment: null,
  kyc_blocker: null,
  approval: null,
  failed_integration: null,
  agent_failure: null,
  task: null,
};
export const DECAY_FLOOR = 0.2;

/** Which kinds each role may ever be shown, enforced in the engine and again in each source. Default deny: a role not listed gets nothing. */
const CUSTOMER_KINDS: AttentionKind[] = ["customer_opportunity", "complaint", "overdue_commitment", "kyc_blocker", "hot_lead", "portfolio_risk", "task"];
export const ROLE_KINDS: Record<string, readonly AttentionKind[]> = {
  RM: CUSTOMER_KINDS,
  MANAGER: [...CUSTOMER_KINDS, "data_quality"], // approvals join the manager feed when the one approvals inbox (Wave 1) opens to managers
  ADMIN: [...ATTENTION_KINDS],
  MARKETING: ["campaign_anomaly"],
};

/** Capacity: how many items one person can realistically work through before the rest should wait. */
export const CAPACITY = {
  itemsPerHour: 1.5,
  minNow: 3,
  maxNow: 12,
  /** Every this many open workload units (pending and overdue tasks) takes one slot off the 'now' lane. */
  workloadStep: 5,
  /** At or over this many open workload units an RM is flagged overloaded. */
  overloadAt: 25,
  /** Fixed offset for working hours (IST). The platform runs for an Indian firm; a per-person zone is a later setting. */
  utcOffsetMinutes: 330,
  workStartHour: 9,
  workEndHour: 18,
  /** Monday to Saturday (0 = Sunday). */
  workDays: [1, 2, 3, 4, 5, 6],
} as const;

export const SNOOZE = { maxDays: 14, overrideMaxHours: 24 } as const;

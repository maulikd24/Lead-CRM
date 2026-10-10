import type { GoalStatusLabel } from "./progress";

/** Everything the rules and the score need about one customer, as plain data. The loader builds it; the engines are pure functions of it. */
export type OutcomeSubject = {
  clientId: string;
  name: string;
  rmId: string | null;
  rmName: string | null;
  createdAt: Date;
  /** KycStatus of the customer's KYC record, or null when there is none. */
  kycStatus: string | null;
  /** Current value of all holdings (latest snapshot per holding). */
  aum: number;
  holdingCount: number;
  /** Value of the same holdings as they stood about 90 days ago; null when no earlier snapshot exists. */
  aumReference: number | null;
  /** Share of the portfolio per asset class, in percent. */
  allocation: { bucket: string; pct: number }[];
  /** Estimate of uninvested cash held with the firm or elsewhere, entered by the RM or imported. Not a bank balance. */
  idleCash: { amount: number; source: string | null; updatedAt: Date | null } | null;
  lastContactAt: Date | null;
  lastTransactionAt: Date | null;
  /** The last time an RM marked a review done. */
  lastReviewAt: Date | null;
  openTickets: number;
  openComplaints: number;
  negativeReviewRecent: boolean;
  marketingConsent: "given" | "withdrawn" | "expired" | "do_not_contact" | "not_recorded";
  goals: { id: string; name: string; targetDate: Date; progress: GoalStatusLabel }[];
  /** Open promises with a due date (conversation insights). */
  commitments: { text: string; dueAt: Date }[];
};

export type Severity = "high" | "medium" | "low";

export type WhyInput = { label: string; value: string };

export type Suggestion = {
  /** Stable per rule and situation: dismissing it hides exactly this situation until it changes. */
  ruleKey: string;
  fingerprint: string;
  title: string;
  detail: string;
  severity: Severity;
  /** 0 to 100, for ordering. */
  rank: number;
  /** The inputs the rule used, in words. Always present. */
  why: WhyInput[];
  /** A task the RM can create from this suggestion (the only action offered). */
  task: { title: string; dueInDays: number };
  /** A draft message template the RM can ask for; null when none fits or the customer should not be messaged. */
  draft: "review_overdue" | "goal_checkin" | "key_date" | null;
};

export type Dismissal = { ruleKey: string; fingerprint: string };

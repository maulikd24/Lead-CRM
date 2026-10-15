// Decision Engine v2: every tunable number in ONE table, with a version. A change is a pull request with an eval case.
// These are judgement values, not fitted weights: the UI labels the score "heuristic, not a probability".

export const ENGINE_VERSION = "nba-v2.0.0-shadow";
export const WEIGHTS_VERSION = "w1";

const DAY = 24 * 60 * 60 * 1000;
export const DAY_MS = DAY;

export const ENGINE_CONFIG = {
  /** Base score per priority tier (as v1 today). */
  baseScore: { High: 75, Medium: 50, Low: 20 },
  /** Largest total of generator bonuses that may be applied. */
  bonusCap: 25,
  /** Contact in the last N hours delays a sales step (service steps are not delayed). */
  recentContactHours: 48,
  recentContactPenalty: 10,
  /** A complaint that is open, or raised within N days, blocks sales. */
  complaintWindowDays: 14,
  /** A decline of a class blocks that class for N days (v1 uses 30). */
  declineWindowDays: 30,
  /** Two failed contact attempts in the window mean unreachable. */
  unreachableWindowDays: 14,
  unreachableAttempts: 2,
  /** WhatsApp free text is allowed only inside this window after the customer's last message. */
  whatsappWindowHours: 24,
  /** Data older than this for a candidate's basis: soft = downrank, hard = cannot be the basis of a recommendation. */
  staleSoftPenalty: 10,
  /** An unconfirmed AI inference is pushed down by this much and can never be the pitch itself. */
  inferredPenalty: 15,
  /** Alternatives shown in the drawer. */
  maxAlternatives: 2,
  /** A "do not recommend this" feedback lasts this long unless the user picks a date. */
  dnrDefaultDays: 180,
  /** Snooze choices (days). */
  snoozeDays: [1, 3, 7] as const,
  /** How long after a decision a later event can be linked to it. */
  outcomeWindowDays: 7,
} as const;

/** Freshness policy per kind of basis: [soft, hard] in days. */
export const FRESHNESS = {
  portfolio: { softDays: 7, hardDays: 30 },
  onboarding: { softDays: 3, hardDays: 14 },
  conversation: { softDays: 30, hardDays: 120 },
  rule: { softDays: 14, hardDays: 60 },
} as const;

/** Shadow exit criteria thresholds (see exit-criteria.ts). Written down here so a change is visible in review. */
export const EXIT_THRESHOLDS = {
  /** Material suppression regressions allowed: none. */
  maxMaterialRegressions: 0,
  /** Consent-policy agreement must be exactly 100%. */
  consentAgreementPct: 100,
  /** Sampled product recommendations that must have been reviewed before the false-positive criterion can pass. */
  minReviewedProductDecisions: 25,
  maxSeriousFalsePositives: 0,
  /** Disagreement rate stability: the daily rate must stay within this many percentage points across the window. */
  disagreementWindowDays: 7,
  disagreementMinDays: 5,
  disagreementMaxSpreadPts: 10,
} as const;

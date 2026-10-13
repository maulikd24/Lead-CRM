import type { NbaPriority } from "@/lib/intelligence/constants";

/**
 * RM copilot "Priority Clients" (bible section 07): which customers need attention, ranked High / Medium / Low, each with
 * a short explicit reason. Pure: the caller loads the inputs; this function does no database work and reads no clock.
 *
 * Score (0-100, additive, then clamped). Every term is listed so the number can be explained to an RM:
 *   - Next Best Action priority:      High 40 · Medium 20 · Low 0
 *   - Next Best Action score:         priorityScore / 5, so 0-20
 *   - Open complaint:                 +25 (service comes before any sales conversation)
 *   - Commitment overdue:             +20 · commitment pending but not overdue: +10
 *   - High-severity situations:       +5 each, capped at +15
 *   - Days since last interaction:    none on record +10 · 30+ days +15 · 14+ days +10 · 7+ days +5 · under 7 days 0
 *
 * Tiers: High at 60 or more, Medium at 35 or more, Low below that.
 * Order: score (highest first), then the longer gap since contact, then name, then client id. Ties therefore never
 * depend on input order, so the same inputs always give the same list.
 */

export type PriorityTier = "High" | "Medium" | "Low";

export type PriorityClientInput = {
  clientId: string;
  name: string;
  nba: { priority: NbaPriority; priorityScore: number; programme: string };
  /** Open commitments the RM made (or the client is waiting on). */
  pendingCommitments: number;
  /** True when at least one open commitment is past its due date. */
  overdueCommitments: boolean;
  openComplaints: number;
  situations: { key: string; severity: "high" | "medium" | "info" }[];
  /** Whole days since the last call, message or note. Null when none is on record. */
  daysSinceLastInteraction: number | null;
};

export type RankedPriorityClient = {
  clientId: string;
  name: string;
  rank: number;
  tier: PriorityTier;
  score: number;
  /** Short, explicit reasons joined into one line, e.g. "Open complaint; commitment overdue; NBA High: Service follow-up". */
  reason: string;
};

export const PRIORITY_WEIGHTS = {
  nbaPriority: { High: 40, Medium: 20, Low: 0 } as Record<NbaPriority, number>,
  nbaScoreDivisor: 5,
  openComplaint: 25,
  commitmentOverdue: 20,
  commitmentPending: 10,
  highSituation: 5,
  highSituationCap: 15,
  noInteraction: 10,
  interactionBands: [
    { minDays: 30, points: 15 },
    { minDays: 14, points: 10 },
    { minDays: 7, points: 5 },
  ],
} as const;

export const TIER_THRESHOLDS = { High: 60, Medium: 35 } as const;

/** Reasons shown per client, so the line stays short. The first ones are the most important. */
const MAX_REASONS = 3;

function tierFor(score: number): PriorityTier {
  if (score >= TIER_THRESHOLDS.High) return "High";
  if (score >= TIER_THRESHOLDS.Medium) return "Medium";
  return "Low";
}

function scoreOne(input: PriorityClientInput): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  score += PRIORITY_WEIGHTS.nbaPriority[input.nba.priority];
  score += Math.round(Math.min(100, Math.max(0, input.nba.priorityScore)) / PRIORITY_WEIGHTS.nbaScoreDivisor);
  reasons.push(`NBA ${input.nba.priority}: ${input.nba.programme}`);

  if (input.openComplaints > 0) {
    score += PRIORITY_WEIGHTS.openComplaint;
    reasons.push(input.openComplaints === 1 ? "Open complaint" : `${input.openComplaints} open complaints`);
  }

  if (input.overdueCommitments) {
    score += PRIORITY_WEIGHTS.commitmentOverdue;
    reasons.push("Commitment overdue");
  } else if (input.pendingCommitments > 0) {
    score += PRIORITY_WEIGHTS.commitmentPending;
    reasons.push(input.pendingCommitments === 1 ? "Commitment pending" : `${input.pendingCommitments} commitments pending`);
  }

  const high = input.situations.filter((s) => s.severity === "high").length;
  if (high > 0) {
    score += Math.min(PRIORITY_WEIGHTS.highSituationCap, high * PRIORITY_WEIGHTS.highSituation);
    reasons.push(high === 1 ? "1 high-urgency situation" : `${high} high-urgency situations`);
  }

  const days = input.daysSinceLastInteraction;
  if (days === null) {
    score += PRIORITY_WEIGHTS.noInteraction;
    reasons.push("No interaction on record");
  } else {
    const band = PRIORITY_WEIGHTS.interactionBands.find((b) => days >= b.minDays);
    if (band) {
      score += band.points;
      reasons.push(`No contact for ${days} days`);
    }
  }

  return { score: Math.min(100, score), reasons };
}

/**
 * Ranks customers for the RM. Returns every input, best first, each with its tier, score and reason.
 * Deterministic for a given set of inputs (see the order rule above).
 */
export function rankPriorityClients(inputs: PriorityClientInput[]): RankedPriorityClient[] {
  const scored = inputs.map((input) => {
    const { score, reasons } = scoreOne(input);
    return { input, score, reasons };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aDays = a.input.daysSinceLastInteraction ?? Number.POSITIVE_INFINITY;
    const bDays = b.input.daysSinceLastInteraction ?? Number.POSITIVE_INFINITY;
    if (bDays !== aDays) return bDays > aDays ? 1 : -1;
    if (a.input.name !== b.input.name) return a.input.name < b.input.name ? -1 : 1;
    return a.input.clientId < b.input.clientId ? -1 : a.input.clientId > b.input.clientId ? 1 : 0;
  });

  return scored.map(({ input, score, reasons }, index) => ({
    clientId: input.clientId,
    name: input.name,
    rank: index + 1,
    tier: tierFor(score),
    score,
    reason: `${reasons.slice(0, MAX_REASONS).join("; ")}.`,
  }));
}

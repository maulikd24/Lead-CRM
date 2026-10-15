import { applyOutcomeToAcceptance } from "./acceptance";
import { isAssetClass, type AssetClass, type Level } from "./constants";

/**
 * The feedback loop (bible section 09). After an RM or AI interaction is logged with one of these outcomes, the
 * customer's acceptance for that asset class, the Next Best Action and a future-communication weight all move.
 * Every step here is a pure function of the outcome history and the clock. Nothing is sent: the outputs only change
 * what the RM sees and what the next NBA refresh suggests.
 */

export const LEARNING_OUTCOMES = ["INTERESTED", "NOT_INTERESTED", "FOLLOW_UP", "CONVERTED", "NOT_RELEVANT"] as const;
export type LearningOutcome = (typeof LEARNING_OUTCOMES)[number];

export const LEARNING_WINDOW_DAYS = 90;
const DAY = 24 * 60 * 60 * 1000;

/** Points each outcome adds to the communication weight, before it fades with age. */
export const COMMUNICATION_POINTS: Record<LearningOutcome, number> = {
  INTERESTED: 3,
  CONVERTED: 2,
  FOLLOW_UP: 2,
  NOT_RELEVANT: -2,
  NOT_INTERESTED: -4,
};

export const COMMUNICATION_WEIGHT_LIMIT = 10;
export const CLASS_WEIGHT_LIMIT = 8;

export type LearningInput = { outcome: string; assetClass: string | null; createdAt: Date };

export function isLearningOutcome(value: string): value is LearningOutcome {
  return (LEARNING_OUTCOMES as readonly string[]).includes(value);
}

/** Step 1, acceptance: the same rules the engine already applies, with a logged Follow up always counting. */
export function acceptanceStep(current: Level, outcome: LearningOutcome, at: Date): { level: Level; reason: string } | null {
  return applyOutcomeToAcceptance(current, outcome, at);
}

/** How much an outcome still counts today: 1 on the day it was logged, falling in a straight line to 0 at the window's end. */
export function freshness(createdAt: Date, now: Date): number {
  const ageDays = (now.getTime() - createdAt.getTime()) / DAY;
  if (ageDays < 0) return 1;
  if (ageDays >= LEARNING_WINDOW_DAYS) return 0;
  return 1 - ageDays / LEARNING_WINDOW_DAYS;
}

const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, Math.round(value)));

/**
 * Step 2, future communication: one number for the whole customer, from -10 (stop reaching out) to +10 (welcome
 * contact). Each outcome in the window adds its points scaled by freshness. The NBA reads it on every refresh.
 */
export function communicationWeight(outcomes: LearningInput[], now: Date): number {
  let total = 0;
  for (const o of outcomes) {
    if (!isLearningOutcome(o.outcome)) continue;
    total += COMMUNICATION_POINTS[o.outcome] * freshness(o.createdAt, now);
  }
  return clamp(total, COMMUNICATION_WEIGHT_LIMIT);
}

export type NbaLearning = {
  /** Points added to a candidate's score for each asset class. Positive = lean in, negative = hold back. */
  classWeight: Partial<Record<AssetClass, number>>;
  /** Asset classes the customer has just converted on: not pitched again as a fresh opportunity. */
  converted: AssetClass[];
  communication: number;
};

/**
 * Step 3, Next Best Action: per asset class weights and the classes already converted, plus the overall communication
 * weight. Pure; computeNextBestAction reads it, so the next refresh moves the suggestion.
 */
export function nbaLearning(outcomes: LearningInput[], now: Date): NbaLearning {
  const raw: Partial<Record<AssetClass, number>> = {};
  const converted = new Set<AssetClass>();
  for (const o of outcomes) {
    if (!isLearningOutcome(o.outcome) || !o.assetClass || !isAssetClass(o.assetClass)) continue;
    const cls = o.assetClass;
    raw[cls] = (raw[cls] ?? 0) + COMMUNICATION_POINTS[o.outcome] * freshness(o.createdAt, now);
    if (o.outcome === "CONVERTED" && freshness(o.createdAt, now) > 0) converted.add(cls);
  }
  const classWeight: Partial<Record<AssetClass, number>> = {};
  for (const [cls, value] of Object.entries(raw) as [AssetClass, number][]) {
    const points = clamp(value, CLASS_WEIGHT_LIMIT);
    if (points !== 0) classWeight[cls] = points;
  }
  return { classWeight, converted: [...converted].sort(), communication: communicationWeight(outcomes, now) };
}

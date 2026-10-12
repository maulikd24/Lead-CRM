import { DAY_MS, reviewStatus } from "./cadence";
import { OUTCOME_CONFIG, type OutcomeConfig } from "./config";
import { formatDate } from "./format";
import type { OutcomeSubject } from "./types";

/**
 * The churn and attention score: a transparent weighted rule set. NOT a trained model and not a prediction about
 * the customer: it adds up eight plain signals, each scaled from 0 to 1 and multiplied by a weight that is written
 * down in config.ts (the weights add up to 100). Every factor is returned with its weight, what it looked at, in
 * words, and the points it contributed, so the "why" is the calculation itself. An input that is not known scores
 * nothing and says so: missing data is never counted as risk. No personal attribute (age, gender, location,
 * religion, income) is used.
 */

export type RiskBand = "high" | "medium" | "low";

export type RiskFactor = {
  key: "contactGap" | "reviewOverdue" | "serviceSignals" | "dormancy" | "valueFall" | "goalsBehind" | "consentWithdrawn" | "kycGap";
  label: string;
  weight: number;
  /** 0 to 1. */
  share: number;
  /** weight times share, one decimal. */
  points: number;
  /** What was looked at, in words. */
  input: string;
};

export type AttentionScore = { score: number; band: RiskBand; factors: RiskFactor[] };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ramp = (value: number, from: number, to: number) => clamp01((value - from) / (to - from));
const daysBetween = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / DAY_MS);

export function computeAttentionScore(s: OutcomeSubject, now: Date, config: OutcomeConfig = OUTCOME_CONFIG): AttentionScore {
  const { weights, contactGapDays, dormancyDays, valueFallPct, bands } = config.risk;
  const factors: RiskFactor[] = [];
  const add = (key: RiskFactor["key"], label: string, share: number, input: string) =>
    factors.push({ key, label, weight: weights[key], share, points: Math.round(weights[key] * share * 10) / 10, input });

  // 1. Time since the last call, message or meeting. Never contacted counts from the day the customer joined.
  {
    const since = s.lastContactAt ?? s.createdAt;
    const days = Math.max(0, daysBetween(since, now));
    add("contactGap", "Time since last contact", ramp(days, contactGapDays.from, contactGapDays.to),
      s.lastContactAt ? `last contact ${formatDate(s.lastContactAt)}, ${days} days ago` : `no contact recorded, counted from ${formatDate(s.createdAt)} (${days} days)`);
  }

  // 2. Review overdue, as a share of the review cadence (full weight when a whole cadence late).
  {
    const r = reviewStatus({ aum: s.aum, lastReviewAt: s.lastReviewAt, createdAt: s.createdAt, now }, config);
    if (r.cadenceDays === null) add("reviewOverdue", "Review overdue", 0, "no review cadence because there are no holdings");
    else add("reviewOverdue", "Review overdue", r.overdue ? clamp01(r.daysOverdue / r.cadenceDays) : 0, r.overdue ? `${r.daysOverdue} days past a ${r.cadenceDays}-day review cadence` : `within the ${r.cadenceDays}-day review cadence`);
  }

  // 3. Open service signals.
  {
    const share = clamp01(0.4 * s.openTickets + 0.6 * s.openComplaints + (s.negativeReviewRecent ? 0.4 : 0));
    add("serviceSignals", "Open service signals", share, `${s.openTickets} open tickets, ${s.openComplaints} open complaints, recent negative call or chat review: ${s.negativeReviewRecent ? "yes" : "no"}`);
  }

  // 4. No transactions for a long time while holding assets.
  {
    if (s.holdingCount === 0) add("dormancy", "No recent transactions", 0, "no holdings, so this is not applied");
    else if (!s.lastTransactionAt) add("dormancy", "No recent transactions", 0, "no transaction recorded, so this is not applied");
    else {
      const days = Math.max(0, daysBetween(s.lastTransactionAt, now));
      add("dormancy", "No recent transactions", ramp(days, dormancyDays.from, dormancyDays.to), `last transaction ${formatDate(s.lastTransactionAt)}, ${days} days ago`);
    }
  }

  // 5. Holdings value fell over about 90 days. Includes market moves and money taken out; the wording says so.
  {
    if (s.aumReference === null || s.aumReference <= 0) add("valueFall", "Fall in holdings value", 0, "no earlier snapshot about 90 days back, so this is not applied");
    else {
      const change = ((s.aum - s.aumReference) / s.aumReference) * 100;
      const fall = Math.max(0, -change);
      add("valueFall", "Fall in holdings value", ramp(fall, valueFallPct.from, valueFallPct.to), `holdings value changed by ${change.toFixed(1)}% over about 90 days (includes market moves and money moved in or out)`);
    }
  }

  // 6. Share of goals that are behind at their assumed rates.
  {
    const behind = s.goals.filter((g) => g.progress === "behind").length;
    add("goalsBehind", "Goals behind", s.goals.length ? behind / s.goals.length : 0, s.goals.length ? `${behind} of ${s.goals.length} goals behind at their assumed rates (illustrative)` : "no goals recorded");
  }

  // 7. Marketing consent withdrawn (or do-not-contact set) is a signal to look at; expired counts half.
  {
    const share = s.marketingConsent === "withdrawn" || s.marketingConsent === "do_not_contact" ? 1 : s.marketingConsent === "expired" ? 0.5 : 0;
    add("consentWithdrawn", "Consent withdrawn", share, `marketing consent is ${s.marketingConsent.replace(/_/g, " ")}`);
  }

  // 8. KYC not approved for a customer who holds assets.
  {
    const gap = s.holdingCount > 0 && s.kycStatus !== "APPROVED";
    add("kycGap", "KYC gap", gap ? 1 : 0, s.holdingCount === 0 ? "no holdings, so this is not applied" : `KYC ${s.kycStatus ? s.kycStatus.replace(/_/g, " ").toLowerCase() : "has no record"}`);
  }

  const score = Math.round(factors.reduce((sum, f) => sum + f.points, 0));
  return { score, band: score >= bands.high ? "high" : score >= bands.medium ? "medium" : "low", factors };
}

/** The factors that added points, biggest first, as short sentences for a "why" tooltip. */
export function topScoreReasons(score: AttentionScore, limit = 3): string[] {
  const top = score.factors.filter((f) => f.points > 0).sort((a, b) => b.points - a.points).slice(0, limit).map((f) => `${f.label}: ${f.input}`);
  return top.length ? top : ["Nothing is flagged by the rules."];
}

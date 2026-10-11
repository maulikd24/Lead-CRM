/**
 * Experiment log maths and rules, written for LOW volume. Pure.
 *
 * A wealth firm may see a few hundred leads a month and a few dozen funded customers, so the honest answer to "how big a
 * test do I need" is often "more than you have". This module says so, with a duration, instead of letting a small test
 * pretend to prove something. Standard two-sided test of two proportions, 5% significance and 80% power by default.
 */

export const EXPERIMENT_STATUSES = ["PLANNED", "RUNNING", "DECIDED"] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];
export const EXPERIMENT_DECISIONS = ["ADOPT", "KEEP_CONTROL", "INCONCLUSIVE", "STOPPED"] as const;
export type ExperimentDecision = (typeof EXPERIMENT_DECISIONS)[number];

/** Inverse of the standard normal CDF (Acklam's rational approximation, relative error about 1e-9). */
export function normalCdfInverse(p: number): number {
  if (p <= 0 || p >= 1) return p <= 0 ? -Infinity : Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - low) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

const normalCdf = (x: number) => {
  // Abramowitz and Stegun 7.1.26 via erf.
  const t = 1 / (1 + 0.3275911 * Math.abs(x / Math.SQRT2));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
};

export type SampleInput = {
  /** The rate you have now (a share between 0 and 1), for example the lead-to-funded rate. */
  baselineRate: number;
  /** The smallest improvement worth acting on. */
  mde: number;
  mdeKind: "absolute" | "relative";
  /** People entering the test per day across all arms. Leave out when unknown. */
  visitorsPerDay?: number;
  arms?: number;
  alpha?: number;
  power?: number;
};

export type SampleGuide =
  | { ok: false; error: string }
  | {
      ok: true;
      perArm: number;
      total: number;
      /** Days to finish at the stated volume; null when no volume was given. */
      days: number | null;
      /** True when the test would finish within 8 weeks. Null when unknown. */
      realistic: boolean | null;
      /** The smallest lift detectable in 28 days at this volume, or null when volume is unknown or nothing is detectable. */
      detectableIn28Days: { relative: number; absolute: number } | null;
      advice: string[];
    };

const REALISTIC_DAYS = 56;

function perArmFor(p1: number, p2: number, alpha: number, power: number): number {
  const zA = normalCdfInverse(1 - alpha / 2);
  const zB = normalCdfInverse(power);
  const pBar = (p1 + p2) / 2;
  const top = zA * Math.sqrt(2 * pBar * (1 - pBar)) + zB * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  return Math.ceil((top * top) / ((p2 - p1) * (p2 - p1)));
}

export function guideSampleSize(input: SampleInput): SampleGuide {
  const { baselineRate: p1, mde, mdeKind } = input;
  const alpha = input.alpha ?? 0.05;
  const power = input.power ?? 0.8;
  const arms = input.arms ?? 2;
  if (!(p1 > 0 && p1 < 1)) return { ok: false, error: "The current rate must be a share between 0% and 100%, for example 4%." };
  if (!(mde > 0)) return { ok: false, error: "The smallest lift worth detecting must be above zero." };
  if (!Number.isInteger(arms) || arms < 2) return { ok: false, error: "A test needs at least two arms." };
  const delta = mdeKind === "relative" ? p1 * mde : mde;
  const p2 = p1 + delta;
  if (!(p2 < 1)) return { ok: false, error: "That lift would take the rate to 100% or more. Choose a smaller lift." };

  const perArm = perArmFor(p1, p2, alpha, power);
  const total = perArm * arms;
  const volume = input.visitorsPerDay;
  const hasVolume = typeof volume === "number" && volume > 0;
  const days = hasVolume ? Math.ceil(total / (volume as number)) : null;
  const realistic = days === null ? null : days <= REALISTIC_DAYS;

  let detectable: { relative: number; absolute: number } | null = null;
  if (hasVolume) {
    const available = Math.floor(((volume as number) * 28) / arms);
    const maxRelative = (1 / p1 - 1) * 0.99;
    if (perArmFor(p1, p1 + p1 * maxRelative, alpha, power) <= available) {
      let lo = 0.001;
      let hi = maxRelative;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (perArmFor(p1, p1 + p1 * mid, alpha, power) <= available) hi = mid;
        else lo = mid;
      }
      detectable = { relative: Math.round(hi * 1000) / 1000, absolute: Math.round(p1 * hi * 100000) / 100000 };
    }
  }

  const advice: string[] = [];
  if (realistic === false) {
    advice.push(`At this volume the test would take about ${days} days. Ask for a larger minimum lift, or test a bigger change.`);
    advice.push("Measure a step earlier in the funnel (a click or a lead instead of a funded customer): there is more volume, so a result arrives sooner. Read it as a lead indicator, not proof of funded customers.");
    advice.push("Or treat the result as directional: run it to the planned end, write down what you saw, and do not claim a winner.");
  } else if (realistic === null) {
    advice.push("Add how many people enter the test per day to see how long it would take.");
  }
  return { ok: true, perArm, total, days, realistic, detectableIn28Days: detectable, advice };
}

export type ExperimentInput = {
  name: string;
  hypothesis: string;
  metric: string;
  mde: number | null;
  mdeKind: "absolute" | "relative";
  startAt: string | null;
  endAt: string | null;
  status: ExperimentStatus;
  decision: ExperimentDecision | null;
  learning: string | null;
  campaignIds: string[];
};

export function validateExperiment(e: ExperimentInput): { ok: true } | { ok: false; error: string } {
  if (!e.name.trim()) return { ok: false, error: "Give the experiment a name." };
  if (!e.hypothesis.trim()) return { ok: false, error: "Write the hypothesis: what you expect to happen and why." };
  if (!e.metric.trim()) return { ok: false, error: "Choose the metric that decides it." };
  if (e.mde !== null && !(e.mde > 0)) return { ok: false, error: "The smallest lift worth detecting must be above zero." };
  if (e.startAt && e.endAt && e.endAt < e.startAt) return { ok: false, error: "The end date cannot be before the start date." };
  if (e.status === "DECIDED") {
    if (!e.endAt) return { ok: false, error: "A decided experiment needs an end date." };
    if (!e.decision) return { ok: false, error: "Record the decision." };
    if (!(e.learning ?? "").trim()) return { ok: false, error: "Write down what you learned, so the next test starts smarter." };
  }
  return { ok: true };
}

export type ArmResult = { visitors: number; conversions: number };
export type DecisionPlan = { verdict: "a_better" | "b_better" | "no_difference_detected" | "inconclusive"; message: string; pValue: number | null };

const MIN_VISITORS_PER_ARM = 1000;
const MIN_CONVERSIONS_TOTAL = 50;

/** A plain read of a finished two-arm test: a clear difference, none detected, or not enough data. Never a proven tie. */
export function planDecision({ a, b }: { a: ArmResult; b: ArmResult }): DecisionPlan {
  if (a.visitors < MIN_VISITORS_PER_ARM || b.visitors < MIN_VISITORS_PER_ARM || a.conversions + b.conversions < MIN_CONVERSIONS_TOTAL) {
    return { verdict: "inconclusive", pValue: null, message: `Not enough data to call it: it needs about ${MIN_VISITORS_PER_ARM.toLocaleString("en-US")} people per arm and ${MIN_CONVERSIONS_TOTAL} conversions in total. Record it as inconclusive and keep what you learned.` };
  }
  const pa = a.conversions / a.visitors;
  const pb = b.conversions / b.visitors;
  const pooled = (a.conversions + b.conversions) / (a.visitors + b.visitors);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.visitors + 1 / b.visitors));
  const z = se > 0 ? (pb - pa) / se : 0;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  if (pValue < 0.05) return { verdict: pb > pa ? "b_better" : "a_better", pValue, message: `${pb > pa ? "B" : "A"} did better, and the gap is larger than chance alone would usually produce (p ${pValue.toFixed(3)}).` };
  return { verdict: "no_difference_detected", pValue, message: "No difference was detected. That does not prove the two are equal; the test may be too small to see a small gap." };
}

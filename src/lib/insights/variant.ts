import { createHash } from "node:crypto";

/**
 * A/B-readiness helpers. Nothing in the agents calls these yet: they exist so a future experiment can be assigned
 * deterministically and read honestly. Server-only (node:crypto).
 */

/** Uniform number in [0, 1) derived from the experiment key and the client id. Same inputs always give the same number. */
function bucket(clientId: string, experimentKey: string): number {
  const digest = createHash("sha256").update(`${experimentKey}\u0000${clientId}`).digest();
  return digest.readUIntBE(0, 6) / 2 ** 48;
}

/**
 * Deterministic variant assignment.
 * - `split` as a number is the share that goes to "B" (0 = everyone "A", 1 = everyone "B").
 * - `split` as an object maps variant names to positive weights, e.g. { control: 2, warm: 1 }.
 * The experiment key is part of the hash, so two experiments split the same customers independently.
 */
export function assignVariant(clientId: string, experimentKey: string, split: number | Record<string, number> = 0.5): string {
  const u = bucket(clientId, experimentKey);
  if (typeof split === "number") {
    if (!Number.isFinite(split) || split < 0 || split > 1) throw new Error("split must be a number between 0 and 1");
    return u < 1 - split ? "A" : "B";
  }
  const entries = Object.entries(split);
  if (entries.length === 0 || entries.some(([, w]) => !Number.isFinite(w) || w <= 0)) throw new Error("split weights must be positive numbers");
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  for (const [name, w] of entries) {
    acc += w / total;
    if (u < acc) return name;
  }
  return entries[entries.length - 1][0];
}

export type Proportion = { successes: number; n: number };
export type ZTestResult = { pA: number; pB: number; diff: number; z: number; pValue: number };

/** Standard normal upper tail via the Abramowitz-Stegun 7.1.26 erf approximation (absolute error about 1.5e-7). */
function twoSidedP(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erfc = poly * Math.exp(-x * x);
  return Math.min(1, Math.max(0, erfc));
}

/** Two-proportion z-test (pooled). Null when it cannot be computed (an empty arm or zero variance). */
export function twoProportionZTest(a: Proportion, b: Proportion): ZTestResult | null {
  if (a.n <= 0 || b.n <= 0) return null;
  const pA = a.successes / a.n;
  const pB = b.successes / b.n;
  const pooled = (a.successes + b.successes) / (a.n + b.n);
  const variance = pooled * (1 - pooled) * (1 / a.n + 1 / b.n);
  if (variance <= 0) return null;
  const z = (pA - pB) / Math.sqrt(variance);
  return { pA, pB, diff: pA - pB, z, pValue: twoSidedP(z) };
}

export const MIN_SAMPLE_PER_ARM = 30;
export const SIGNIFICANCE_LEVEL = 0.05;

export type Comparison =
  | { status: "too_early"; reason: string }
  | { status: "not_significant"; result: ZTestResult | null }
  | { status: "significant"; result: ZTestResult; better: "a" | "b" };

/**
 * Compares two arms. Anything below the minimum sample on EITHER arm is labelled "too early" whatever the gap looks like,
 * because small samples routinely produce impressive-looking noise.
 */
export function compareVariants(a: Proportion, b: Proportion, opts: { minSample?: number; alpha?: number } = {}): Comparison {
  const minSample = opts.minSample ?? MIN_SAMPLE_PER_ARM;
  if (a.n < minSample || b.n < minSample) return { status: "too_early", reason: `needs at least ${minSample} in each group (have ${a.n} and ${b.n})` };
  const result = twoProportionZTest(a, b);
  if (!result || result.pValue >= (opts.alpha ?? SIGNIFICANCE_LEVEL)) return { status: "not_significant", result };
  return { status: "significant", result, better: result.diff > 0 ? "a" : "b" };
}

import { twoProportionZTest } from "@/lib/insights/variant";

/**
 * Result reading for an experiment. Pure: the caller supplies the exposures (who was put in which arm) and the
 * outcomes (what happened to them). No database, no clock.
 *
 * The conversion outcome defaults to campaign.funded.attributed, the attribution layer's own outcome event, so a
 * "converted" subject means the same thing here as on the attribution impact view.
 *
 * Rules:
 * - A subject counts once. Its first exposure decides its arm; later exposures to other arms are counted in
 *   `duplicateExposures` and ignored.
 * - Only subjects that were exposed can convert here. Outcomes for anyone else are ignored.
 * - Every non-control arm is compared with the control with a two-proportion z-test (two-sided, pooled).
 * - Several arms are compared with the control, so each p-value is multiplied by the number of comparisons
 *   (Bonferroni). That is deliberately conservative.
 * - A difference is called significant only when the adjusted p-value is below 0.05 (95% confidence). Anything else
 *   is reported as "not significant", with the numbers shown. No winner is named below that bar.
 */

export const CONVERSION_OUTCOME = "campaign.funded.attributed";
export const SIGNIFICANCE_ALPHA = 0.05;

export type Exposure = { subjectId: string; armKey: string };
export type Outcome = { subjectId: string; type: string };

export type SummariseOptions = {
  /** The baseline arm every other arm is compared with. */
  control: string;
  /** Arms to report even when nobody was exposed to them yet. Defaults to every arm seen in the exposures. */
  arms?: readonly string[];
  /** Outcome type that counts as a conversion. Defaults to CONVERSION_OUTCOME. */
  conversionType?: string;
};

export type ArmRow = { armKey: string; exposed: number; converted: number; rate: number | null };

export type ArmComparison = {
  armKey: string;
  control: string;
  /** Arm rate minus control rate, in percentage points. Null when either arm has no subjects. */
  diffPoints: number | null;
  /** Two-sided p-value before correction. Null when no test can be computed (empty arm or no variation). */
  pValue: number | null;
  /** p-value multiplied by the number of comparisons, capped at 1. */
  adjustedPValue: number | null;
  significant: boolean;
  reading: string;
};

export type Summary = {
  control: string;
  alpha: number;
  duplicateExposures: number;
  arms: ArmRow[];
  comparisons: ArmComparison[];
  verdict: string;
};

const pct = (rate: number) => `${(rate * 100).toFixed(1)}%`;

export function summarise(exposures: readonly Exposure[], outcomes: readonly Outcome[], opts: SummariseOptions): Summary {
  const conversionType = opts.conversionType ?? CONVERSION_OUTCOME;

  // Each subject counts once, under the arm of its first exposure.
  const armOf = new Map<string, string>();
  let duplicateExposures = 0;
  for (const e of exposures) {
    if (armOf.has(e.subjectId)) {
      duplicateExposures += 1;
      continue;
    }
    armOf.set(e.subjectId, e.armKey);
  }

  const converted = new Set<string>();
  for (const o of outcomes) {
    if (o.type === conversionType && armOf.has(o.subjectId)) converted.add(o.subjectId);
  }

  const armKeys: string[] = [];
  const addArm = (k: string) => {
    if (!armKeys.includes(k)) armKeys.push(k);
  };
  addArm(opts.control);
  for (const k of opts.arms ?? []) addArm(k);
  for (const k of armOf.values()) addArm(k);

  const counts = new Map<string, { exposed: number; converted: number }>();
  for (const k of armKeys) counts.set(k, { exposed: 0, converted: 0 });
  for (const [subjectId, armKey] of armOf) {
    const c = counts.get(armKey);
    if (!c) continue;
    c.exposed += 1;
    if (converted.has(subjectId)) c.converted += 1;
  }

  const arms: ArmRow[] = armKeys.map((armKey) => {
    const c = counts.get(armKey) ?? { exposed: 0, converted: 0 };
    return { armKey, exposed: c.exposed, converted: c.converted, rate: c.exposed > 0 ? c.converted / c.exposed : null };
  });

  const base = counts.get(opts.control) ?? { exposed: 0, converted: 0 };
  const others = armKeys.filter((k) => k !== opts.control);
  const m = others.length;

  const comparisons: ArmComparison[] = others.map((armKey) => {
    const c = counts.get(armKey) ?? { exposed: 0, converted: 0 };
    const row = arms.find((r) => r.armKey === armKey);
    const controlRow = arms.find((r) => r.armKey === opts.control);
    if (!row || !controlRow || row.rate === null || controlRow.rate === null) {
      return {
        armKey,
        control: opts.control,
        diffPoints: null,
        pValue: null,
        adjustedPValue: null,
        significant: false,
        reading: `${armKey}: no subjects in one of the arms, so no comparison yet.`,
      };
    }
    const test = twoProportionZTest({ successes: c.converted, n: c.exposed }, { successes: base.converted, n: base.exposed });
    const diffPoints = (row.rate - controlRow.rate) * 100;
    if (!test) {
      return {
        armKey,
        control: opts.control,
        diffPoints,
        pValue: null,
        adjustedPValue: null,
        significant: false,
        reading: `${armKey} vs ${opts.control}: ${diffPoints >= 0 ? "+" : ""}${diffPoints.toFixed(1)} points, not significant (no variation to test).`,
      };
    }
    const adjustedPValue = Math.min(1, test.pValue * m);
    const significant = adjustedPValue < SIGNIFICANCE_ALPHA;
    const reading = significant
      ? `${armKey} vs ${opts.control}: ${pct(row.rate)} vs ${pct(controlRow.rate)} (${diffPoints >= 0 ? "+" : ""}${diffPoints.toFixed(1)} points), significant at 95% after correction (p=${adjustedPValue.toFixed(4)}).`
      : `${armKey} vs ${opts.control}: ${pct(row.rate)} vs ${pct(controlRow.rate)} (${diffPoints >= 0 ? "+" : ""}${diffPoints.toFixed(1)} points), not significant at 95% (p=${adjustedPValue.toFixed(4)} after correction).`;
    return { armKey, control: opts.control, diffPoints, pValue: test.pValue, adjustedPValue, significant, reading };
  });

  const sig = comparisons.filter((c) => c.significant);
  const verdict =
    sig.length === 0
      ? "Not significant: no arm differs from the control at 95% confidence. No winner is claimed."
      : sig.map((c) => `${c.armKey} differs from ${opts.control} at 95% confidence (${(c.diffPoints ?? 0) >= 0 ? "higher" : "lower"}).`).join(" ");

  return { control: opts.control, alpha: SIGNIFICANCE_ALPHA, duplicateExposures, arms, comparisons, verdict };
}

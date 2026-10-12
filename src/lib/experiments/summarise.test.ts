import { describe, expect, it } from "vitest";

import { CONVERSION_OUTCOME, type Exposure, type Outcome, summarise } from "./summarise";

/** Synthetic data only: `n` subjects in an arm, the first `converted` of them with a conversion outcome. */
function cohort(prefix: string, armKey: string, n: number, converted: number): { exposures: Exposure[]; outcomes: Outcome[] } {
  const exposures: Exposure[] = [];
  const outcomes: Outcome[] = [];
  for (let i = 0; i < n; i++) {
    const subjectId = `${prefix}-${i}`;
    exposures.push({ subjectId, armKey });
    if (i < converted) outcomes.push({ subjectId, type: CONVERSION_OUTCOME });
  }
  return { exposures, outcomes };
}

describe("summarise", () => {
  it("calls a clearly large difference significant at 95% and names the arm", () => {
    const a = cohort("c", "control", 1000, 100); // 10%
    const b = cohort("t", "variant", 1000, 200); // 20%
    const s = summarise([...a.exposures, ...b.exposures], [...a.outcomes, ...b.outcomes], { control: "control" });

    const row = s.arms.find((r) => r.armKey === "variant");
    expect(row).toMatchObject({ exposed: 1000, converted: 200, rate: 0.2 });
    const cmp = s.comparisons[0];
    expect(cmp.armKey).toBe("variant");
    expect(cmp.diffPoints).toBeCloseTo(10, 6);
    expect(cmp.adjustedPValue).toBeLessThan(0.05);
    expect(cmp.significant).toBe(true);
    expect(cmp.reading).toContain("significant at 95%");
    expect(s.verdict).toContain("variant differs from control at 95% confidence");
  });

  it("says not significant for a tiny difference and claims no winner", () => {
    const a = cohort("c", "control", 1000, 100); // 10.0%
    const b = cohort("t", "variant", 1000, 102); // 10.2%
    const s = summarise([...a.exposures, ...b.exposures], [...a.outcomes, ...b.outcomes], { control: "control" });

    const cmp = s.comparisons[0];
    expect(cmp.significant).toBe(false);
    expect(cmp.adjustedPValue).toBeGreaterThan(0.05);
    expect(cmp.reading).toContain("not significant");
    expect(s.verdict).toMatch(/^Not significant/);
    expect(s.verdict).not.toMatch(/\b(ahead|better|wins?)\b/i);
  });

  it("multiplies each p-value by the number of comparisons (conservative correction)", () => {
    const a = cohort("c", "control", 1000, 100);
    const b = cohort("t", "variant", 1000, 140); // 14%: uncorrected p is small
    const c = cohort("u", "bold", 1000, 140);
    const exposures = [...a.exposures, ...b.exposures, ...c.exposures];
    const outcomes = [...a.outcomes, ...b.outcomes, ...c.outcomes];
    const one = summarise([...a.exposures, ...b.exposures], [...a.outcomes, ...b.outcomes], { control: "control" });
    const two = summarise(exposures, outcomes, { control: "control" });

    expect(two.comparisons).toHaveLength(2);
    expect(two.comparisons[0].adjustedPValue).toBeGreaterThan(one.comparisons[0].adjustedPValue ?? 0);
  });

  it("counts a subject once under its first arm and ignores outcomes from unexposed subjects", () => {
    const exposures: Exposure[] = [
      { subjectId: "x", armKey: "control" },
      { subjectId: "x", armKey: "variant" },
      { subjectId: "y", armKey: "variant" },
    ];
    const outcomes: Outcome[] = [
      { subjectId: "x", type: CONVERSION_OUTCOME },
      { subjectId: "ghost", type: CONVERSION_OUTCOME },
      { subjectId: "y", type: "lead.contacted" },
    ];
    const s = summarise(exposures, outcomes, { control: "control", arms: ["control", "variant", "bold"] });

    expect(s.duplicateExposures).toBe(1);
    expect(s.arms.find((r) => r.armKey === "control")).toMatchObject({ exposed: 1, converted: 1, rate: 1 });
    expect(s.arms.find((r) => r.armKey === "variant")).toMatchObject({ exposed: 1, converted: 0, rate: 0 });
    expect(s.arms.find((r) => r.armKey === "bold")).toMatchObject({ exposed: 0, converted: 0, rate: null });
    expect(s.comparisons.find((c) => c.armKey === "bold")?.reading).toContain("no subjects");
  });
});

import { describe, expect, it } from "vitest";

import { headlineKpis, safeRatio, type KpiInput } from "./kpis";

const base: KpiInput = { leadsCreated: 40, leadsConverted: 10, stageDaysTotal: 90, stageMoves: 30, complaintsOpen: 4, complaintsOverdue: 1, promisesOverdue: 2 };

describe("safeRatio", () => {
  it("divides when the base is positive", () => {
    expect(safeRatio(1, 4)).toBe(0.25);
  });
  it("returns null, never Infinity or NaN, when there is no base", () => {
    expect(safeRatio(5, 0)).toBeNull();
    expect(safeRatio(0, 0)).toBeNull();
    expect(safeRatio(5, -2)).toBeNull();
    expect(safeRatio(Number.NaN, 2)).toBeNull();
    expect(safeRatio(3, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("headlineKpis", () => {
  it("computes conversion and the average days from stage to stage", () => {
    const r = headlineKpis(base);
    expect(r).toEqual({
      ok: true,
      kpis: { leadsCreated: 40, leadsConverted: 10, conversionRate: 0.25, avgDaysStageToStage: 3, complaintsOpen: 4, complaintsOverdue: 1, promisesOverdue: 2 },
    });
  });
  it("is deterministic: the same input gives the same output", () => {
    expect(headlineKpis(base)).toEqual(headlineKpis({ ...base }));
  });
  it("gives null, not Infinity, for conversion with no leads and the average with no moves", () => {
    const r = headlineKpis({ ...base, leadsCreated: 0, leadsConverted: 0, stageMoves: 0, stageDaysTotal: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.kpis.conversionRate).toBeNull();
      expect(r.kpis.avgDaysStageToStage).toBeNull();
    }
  });
  it("refuses impossible counts instead of computing a wrong headline", () => {
    expect(headlineKpis({ ...base, leadsConverted: 50 })).toEqual({ ok: false, problems: ["converted_exceeds_created"] });
    expect(headlineKpis({ ...base, complaintsOverdue: 9 })).toEqual({ ok: false, problems: ["overdue_exceeds_open"] });
    expect(headlineKpis({ ...base, promisesOverdue: -1 })).toEqual({ ok: false, problems: ["negative_or_non_finite"] });
    expect(headlineKpis({ ...base, stageMoves: Number.NaN })).toEqual({ ok: false, problems: ["negative_or_non_finite"] });
  });
  it("emits aggregates only: every value is a number or null, and there is no list or row", () => {
    const r = headlineKpis(base);
    if (!r.ok) throw new Error("expected ok");
    for (const v of Object.values(r.kpis)) expect(v === null || typeof v === "number").toBe(true);
    for (const v of Object.values(r.kpis)) expect(Array.isArray(v)).toBe(false);
  });
});

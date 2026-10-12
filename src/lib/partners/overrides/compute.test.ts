import { describe, expect, it } from "vitest";

import { ancestorsOf, computeOverrides, diffOverrides, type OverrideSource } from "./compute";
import type { OverrideRule } from "./rules";

const rule = (over: Partial<OverrideRule> = {}): OverrideRule => ({ id: "o1", level: 1, ratePercent: "5", capPerAccrual: null, effectiveFrom: "2026-04-01T00:00:00.000Z", effectiveTo: null, ...over });
const src = (over: Partial<OverrideSource> = {}): OverrideSource => ({ accrualId: "a1", partnerId: "kid", amount: "1000", accrualDate: "2026-09-10T00:00:00.000Z", ancestors: [{ id: "parent", status: "ACTIVE" }, { id: "grand", status: "ACTIVE" }], ...over });

describe("ancestorsOf", () => {
  const parent = new Map<string, string | null>([["c", "b"], ["b", "a"], ["a", null]]);
  it("walks up the roll-up, nearest first", () => {
    expect(ancestorsOf("c", parent, 5)).toEqual(["b", "a"]);
    expect(ancestorsOf("a", parent, 5)).toEqual([]);
  });
  it("stops at the level limit and cannot loop on a cycle", () => {
    expect(ancestorsOf("c", parent, 1)).toEqual(["b"]);
    const cyc = new Map<string, string | null>([["x", "y"], ["y", "x"]]);
    expect(ancestorsOf("x", cyc, 5)).toEqual(["y"]);
  });
  it("an unknown partner has no ancestors", () => {
    expect(ancestorsOf("nobody", parent, 5)).toEqual([]);
  });
});

describe("computeOverrides: none unless a rule exists", () => {
  it("with no rules there are no override lines at all", () => {
    expect(computeOverrides(src(), [])).toEqual([]);
  });
  it("pays the level-1 rule to the parent, as a percent of the sub-partner's commission", () => {
    const r = computeOverrides(src(), [rule()]);
    expect(r).toEqual([{ key: "a1:o1:parent", sourceAccrualId: "a1", ruleId: "o1", partnerId: "parent", level: 1, amount: "50.00", capped: false, accrualDate: "2026-09-10T00:00:00.000Z" }]);
  });
  it("one rule per level: level 2 goes to the grandparent", () => {
    const r = computeOverrides(src(), [rule(), rule({ id: "o2", level: 2, ratePercent: "2" })]);
    expect(r.map((x) => [x.partnerId, x.amount])).toEqual([["parent", "50.00"], ["grand", "20.00"]]);
  });
  it("a level with no ancestor earns nothing, not an error", () => {
    expect(computeOverrides(src({ ancestors: [] }), [rule()])).toEqual([]);
    expect(computeOverrides(src({ ancestors: [{ id: "parent", status: "ACTIVE" }] }), [rule({ level: 2 })])).toEqual([]);
  });
  it("applies the cap per accrual and says it did", () => {
    const r = computeOverrides(src({ amount: "100000" }), [rule({ capPerAccrual: "500" })]);
    expect(r[0]).toMatchObject({ amount: "500.00", capped: true });
    expect(computeOverrides(src({ amount: "1000" }), [rule({ capPerAccrual: "500" })])[0]).toMatchObject({ amount: "50.00", capped: false });
  });
  it("respects the rule's dates against the accrual's date", () => {
    expect(computeOverrides(src({ accrualDate: "2026-03-31T00:00:00.000Z" }), [rule()])).toEqual([]);
    expect(computeOverrides(src(), [rule({ effectiveTo: "2026-09-10T00:00:00.000Z" })])).toEqual([]);
    expect(computeOverrides(src(), [rule({ effectiveTo: "2026-09-11T00:00:00.000Z" })])).toHaveLength(1);
  });
  it("a negative commission accrual (a clawback) gives a negative override, capped symmetrically", () => {
    const r = computeOverrides(src({ amount: "-100000" }), [rule({ capPerAccrual: "500" })]);
    expect(r[0]).toMatchObject({ amount: "-500.00", capped: true });
    expect(computeOverrides(src({ amount: "-1000" }), [rule()])[0].amount).toBe("-50.00");
  });
  it("rounds once to paise, half away from zero", () => {
    expect(computeOverrides(src({ amount: "0.10" }), [rule()])[0].amount).toBe("0.01"); // 0.005 -> 0.01
    expect(computeOverrides(src({ amount: "-0.10" }), [rule()])[0].amount).toBe("-0.01");
  });
  it("a terminated ancestor earns nothing; a suspended one still accrues (payout holds it)", () => {
    expect(computeOverrides(src({ ancestors: [{ id: "parent", status: "TERMINATED" }] }), [rule()])).toEqual([]);
    expect(computeOverrides(src({ ancestors: [{ id: "parent", status: "SUSPENDED" }] }), [rule()])).toHaveLength(1);
  });
  it("a zero commission gives no line", () => {
    expect(computeOverrides(src({ amount: "0" }), [rule()])).toEqual([]);
  });
  it("is deterministic: same input, same keys, in level order", () => {
    const a = computeOverrides(src(), [rule({ id: "o2", level: 2 }), rule()]);
    const b = computeOverrides(src(), [rule(), rule({ id: "o2", level: 2 })]);
    expect(a).toEqual(b);
  });
});

describe("diffOverrides: idempotent", () => {
  const computed = computeOverrides(src(), [rule()]);
  it("creates what is missing", () => {
    expect(diffOverrides(computed, [])).toEqual({ create: computed, update: [], unchanged: 0 });
  });
  it("is a no-op when everything exists and agrees", () => {
    expect(diffOverrides(computed, [{ key: "a1:o1:parent", amount: "50", status: "ACCRUED" }])).toEqual({ create: [], update: [], unchanged: 1 });
  });
  it("updates an amount that changed while the accrual is still open", () => {
    const r = diffOverrides(computed, [{ key: "a1:o1:parent", amount: "40", status: "ACCRUED" }]);
    expect(r.update).toEqual([{ key: "a1:o1:parent", amount: "50.00" }]);
  });
  it("never touches an accrual that is already in a payout", () => {
    const r = diffOverrides(computed, [{ key: "a1:o1:parent", amount: "40", status: "INCLUDED_IN_PAYOUT" }]);
    expect(r).toEqual({ create: [], update: [], unchanged: 1 });
  });
});

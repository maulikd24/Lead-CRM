import { describe, expect, it } from "vitest";

import { planTaxRuleChange } from "./plan";
import type { TaxRule } from "./rules";

const now = new Date("2026-10-10T06:00:00.000Z"); // 11:30 IST on 10 Oct 2026
const existing = (over: Partial<TaxRule> = {}): TaxRule => ({ id: "old", kind: "TDS", label: "Section X", ratePercent: "10", thresholdAmount: "20000", partnerTypes: [], panStatus: "ANY", gstRegistration: "ANY", gstMode: null, effectiveFrom: "2026-04-01T00:00:00.000Z", effectiveTo: null, ...over });
const input = (over: Record<string, unknown> = {}) => ({ kind: "TDS", label: "Section X", ratePercent: "5", thresholdAmount: "20000", effectiveFrom: "2026-11-01", ...over });

describe("planTaxRuleChange", () => {
  it("creates a valid rule into an empty set, with no default filled in", () => {
    const p = planTaxRuleChange({ op: "create", rule: input() }, [], now);
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.writes).toHaveLength(1);
      expect(p.writes[0]).toMatchObject({ type: "create", data: { kind: "TDS", ratePercent: "5" } });
      expect(p.summary).toMatch(/Add/);
    }
  });
  it("refuses an invalid rule with the reasons", () => {
    const p = planTaxRuleChange({ op: "create", rule: input({ ratePercent: "" }) }, [], now);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.errors.join(" ")).toMatch(/no default rate/i);
  });
  it("refuses a rule that overlaps an existing one of the same kind and reach", () => {
    const p = planTaxRuleChange({ op: "create", rule: input({ effectiveFrom: "2026-08-01" }) }, [existing()], now);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.errors.join(" ")).toMatch(/overlaps/i);
  });
  it("replace ends the old rule where the new one starts, and adds the new one", () => {
    const p = planTaxRuleChange({ op: "replace", ruleId: "old", rule: input() }, [existing()], now);
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.writes).toEqual([
        { type: "end", id: "old", effectiveTo: "2026-10-31T18:30:00.000Z" },
        expect.objectContaining({ type: "create" }),
      ]);
    }
  });
  it("replace refuses an unknown rule, a start before today, or a start not after the old rule's", () => {
    expect(planTaxRuleChange({ op: "replace", ruleId: "nope", rule: input() }, [existing()], now).ok).toBe(false);
    expect(planTaxRuleChange({ op: "replace", ruleId: "old", rule: input({ effectiveFrom: "2026-10-01" }) }, [existing()], now).ok).toBe(false);
    expect(planTaxRuleChange({ op: "replace", ruleId: "old", rule: input({ effectiveFrom: "2026-04-01" }) }, [existing({ effectiveFrom: "2026-04-01T00:00:00.000Z" })], now).ok).toBe(false);
  });
  it("replace can start today", () => {
    expect(planTaxRuleChange({ op: "replace", ruleId: "old", rule: input({ effectiveFrom: "2026-10-10" }) }, [existing()], now).ok).toBe(true);
  });
  it("retire sets an end date, never in the past and never extending the rule", () => {
    const ok = planTaxRuleChange({ op: "retire", ruleId: "old", effectiveTo: "2026-12-31" }, [existing()], now);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.writes).toEqual([{ type: "end", id: "old", effectiveTo: "2026-12-30T18:30:00.000Z" }]);
    expect(planTaxRuleChange({ op: "retire", ruleId: "old", effectiveTo: "2026-09-01" }, [existing()], now).ok).toBe(false);
    expect(planTaxRuleChange({ op: "retire", ruleId: "old", effectiveTo: "2027-06-01" }, [existing({ effectiveTo: "2027-03-31T00:00:00.000Z" })], now).ok).toBe(false);
    expect(planTaxRuleChange({ op: "retire", ruleId: "nope", effectiveTo: "2026-12-31" }, [existing()], now).ok).toBe(false);
  });
  it("rejects an unknown operation", () => {
    expect(planTaxRuleChange({ op: "delete", ruleId: "old" } as never, [existing()], now).ok).toBe(false);
  });
});

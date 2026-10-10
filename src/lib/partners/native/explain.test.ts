import { describe, expect, it } from "vitest";

import { explainAccrual, type ExplainInput } from "./explain";

const base: ExplainInput = {
  storedAmount: "150",
  grossRevenue: "10000",
  revenueType: "BROKERAGE",
  eventDate: "2026-09-10T00:00:00.000Z",
  computationVersion: "v1",
  rule: { rateType: "PERCENT_OF_GROSS", percentRate: "1.5", flatRate: null, productCategory: null, transactionType: null, validFrom: "2026-01-01T00:00:00.000Z", validTo: null, slabs: [] },
  planName: "Standard plan",
};

describe("explainAccrual", () => {
  it("explains a percent-of-gross rule step by step and confirms the amount", () => {
    const e = explainAccrual(base);
    expect(e.kind).toBe("percent");
    expect(e.matches).toBe(true);
    expect(e.recomputed).toBe("150.00");
    expect(e.headline).toBe("1.5% of gross revenue 10000.00 = 150.00");
    expect(e.steps.join(" ")).toContain("Standard plan");
    expect(e.steps.join(" ")).toContain("all product categories");
    expect(e.steps.join(" ")).toContain("all transaction types");
  });

  it("rounds only once, to paise, on the exact value", () => {
    // 1.25% of 333.33 = 4.166625 -> 4.17
    const e = explainAccrual({ ...base, grossRevenue: "333.33", storedAmount: "4.166625", rule: { ...base.rule!, percentRate: "1.25" } });
    expect(e.recomputed).toBe("4.17");
    expect(e.matches).toBe(true);
  });

  it("treats a net-based rule the way the engine does, and says so", () => {
    const e = explainAccrual({ ...base, rule: { ...base.rule!, rateType: "PERCENT_OF_NET" } });
    expect(e.matches).toBe(true);
    expect(e.steps.join(" ")).toMatch(/net/i);
    expect(e.steps.join(" ")).toMatch(/gross/i);
  });

  it("explains a flat rule", () => {
    const e = explainAccrual({ ...base, storedAmount: "25", rule: { ...base.rule!, rateType: "FLAT_PER_TRANSACTION", percentRate: null, flatRate: "25" } });
    expect(e.kind).toBe("flat");
    expect(e.headline).toBe("Flat 25.00 per transaction");
    expect(e.matches).toBe(true);
  });

  it("explains which slab applied", () => {
    const slabs = [
      { minAmount: "0", maxAmount: "5000", rate: "1" },
      { minAmount: "5000", maxAmount: "20000", rate: "2" },
      { minAmount: "20000", maxAmount: null, rate: "3" },
    ];
    const e = explainAccrual({ ...base, storedAmount: "200", rule: { ...base.rule!, rateType: "SLAB", percentRate: null, slabs } });
    expect(e.kind).toBe("slab");
    expect(e.headline).toBe("2% (slab 5000.00 to under 20000.00) of gross revenue 10000.00 = 200.00");
    expect(e.matches).toBe(true);
    expect(e.slabs).toEqual([
      { label: "0.00 to under 5000.00", rate: "1", applied: false },
      { label: "5000.00 to under 20000.00", rate: "2", applied: true },
      { label: "20000.00 and above", rate: "3", applied: false },
    ]);
  });

  it("picks the open-ended slab at the boundary the engine uses (minimum inclusive, maximum exclusive)", () => {
    const slabs = [{ minAmount: "0", maxAmount: "10000", rate: "1" }, { minAmount: "10000", maxAmount: null, rate: "3" }];
    const e = explainAccrual({ ...base, storedAmount: "300", rule: { ...base.rule!, rateType: "SLAB", percentRate: null, slabs } });
    expect(e.slabs!.find((s) => s.applied)!.rate).toBe("3");
    expect(e.matches).toBe(true);
  });

  it("flags a stored amount that no longer agrees with the rule as it stands", () => {
    const e = explainAccrual({ ...base, storedAmount: "140" });
    expect(e.matches).toBe(false);
    expect(e.recomputed).toBe("150.00");
    expect(e.note).toMatch(/rule has changed|differs/i);
  });

  it("says plainly when there is no rule on file", () => {
    const e = explainAccrual({ ...base, rule: null });
    expect(e.kind).toBe("none");
    expect(e.matches).toBeNull();
    expect(e.headline).toMatch(/no rule/i);
  });

  it("does not guess when a slab rule has no slab for the amount", () => {
    const e = explainAccrual({ ...base, rule: { ...base.rule!, rateType: "SLAB", percentRate: null, slabs: [{ minAmount: "50000", maxAmount: null, rate: "2" }] } });
    expect(e.recomputed).toBeNull();
    expect(e.matches).toBeNull();
  });

  it("names the narrower category and type a rule is limited to", () => {
    const e = explainAccrual({ ...base, rule: { ...base.rule!, productCategory: "EQUITY", transactionType: "BUY" } });
    expect(e.steps.join(" ")).toContain("Equity");
    expect(e.steps.join(" ")).toContain("Buy");
  });

  it("never mentions tax: none is modelled", () => {
    expect(JSON.stringify(explainAccrual(base))).not.toMatch(/tds|gst/i);
  });
});


describe("explainAccrual for an override accrual", () => {
  const ov = { ...base, storedAmount: "50", rule: null, planName: null, override: { level: 1, ratePercent: "5", capPerAccrual: null, sourceAmount: "1000" } };
  it("explains the share of a sub-partner's commission, with the working when the source amount is shown", () => {
    const e = explainAccrual(ov);
    expect(e.kind).toBe("override");
    expect(e.headline).toBe("5% of a level 1 sub-partner's commission 1000.00 = 50.00");
    expect(e.recomputed).toBe("50.00");
    expect(e.matches).toBe(true);
  });
  it("applies and mentions the cap", () => {
    const e = explainAccrual({ ...ov, storedAmount: "30", override: { ...ov.override, capPerAccrual: "30" } });
    expect(e.recomputed).toBe("30.00");
    expect(e.matches).toBe(true);
    expect(e.steps.join(" ")).toMatch(/cap/i);
    expect(e.headline).toMatch(/capped at 30\.00/);
  });
  it("never reveals the sub-partner's figure when the source amount is withheld", () => {
    const e = explainAccrual({ ...ov, override: { ...ov.override, sourceAmount: null } });
    expect(e.kind).toBe("override");
    expect(e.recomputed).toBeNull();
    expect(e.matches).toBeNull();
    expect(JSON.stringify(e)).not.toContain("1000");
    expect(e.headline).toBe("5% of a level 1 sub-partner's commission");
  });
  it("flags a stored amount that no longer agrees with the rule", () => {
    expect(explainAccrual({ ...ov, storedAmount: "49" }).matches).toBe(false);
  });
});

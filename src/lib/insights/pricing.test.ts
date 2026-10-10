import { describe, expect, it } from "vitest";
import { estimateCostUsd, estimateUsageCost, formatUsd, PRICE_TABLE } from "./pricing";

describe("estimateCostUsd", () => {
  it("prices a known model from the table", () => {
    const [model, price] = Object.entries(PRICE_TABLE).find(([, p]) => p.inputPerMTok > 0)!;
    expect(estimateCostUsd(model, 1_000_000, 1_000_000)).toBeCloseTo(price.inputPerMTok + price.outputPerMTok, 6);
  });
  it("is zero for the fake test model", () => {
    expect(estimateCostUsd("fake", 5000, 100)).toBe(0);
  });
  it("matches a dated model id by its base id", () => {
    const base = Object.keys(PRICE_TABLE).find((m) => m.startsWith("claude-"))!;
    expect(estimateCostUsd(`${base}-20261001`, 1000, 1000)).toBe(estimateCostUsd(base, 1000, 1000));
  });
  it("returns null for an unknown model", () => {
    expect(estimateCostUsd("mystery-model-9", 1000, 1000)).toBeNull();
    expect(estimateCostUsd("", 1000, 1000)).toBeNull();
  });
  it("is zero tokens -> zero cost", () => {
    expect(estimateCostUsd("claude-sonnet-5-5", 0, 0)).toBe(0);
  });
});

describe("estimateUsageCost", () => {
  it("sums known rows and flags unknown models as partial", () => {
    const r = estimateUsageCost([
      { model: "claude-sonnet-5-5", inputTokens: 1000, outputTokens: 200 },
      { model: "mystery", inputTokens: 500, outputTokens: 50 },
    ]);
    expect(r.usd).toBeGreaterThan(0);
    expect(r.partial).toBe(true);
    expect(r.unknownModels).toEqual(["mystery"]);
  });
  it("is n/a (null) when every model with usage is unknown", () => {
    const r = estimateUsageCost([{ model: "mystery", inputTokens: 10, outputTokens: 1 }]);
    expect(r.usd).toBeNull();
  });
  it("ignores unknown models that used no tokens", () => {
    const r = estimateUsageCost([{ model: "mystery", inputTokens: 0, outputTokens: 0 }, { model: "fake", inputTokens: 0, outputTokens: 0 }]);
    expect(r.usd).toBe(0);
    expect(r.partial).toBe(false);
  });
  it("is zero for no rows", () => {
    expect(estimateUsageCost([]).usd).toBe(0);
  });
});

describe("formatUsd", () => {
  it("shows n/a for null and a sensible precision otherwise", () => {
    expect(formatUsd(null)).toBe("n/a");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.0123)).toBe("$0.012");
    expect(formatUsd(12.3456)).toBe("$12.35");
  });
});

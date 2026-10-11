import { describe, expect, it } from "vitest";
import { approxTokens, estimateCostUsd, FALLBACK_PRICE, priceFor } from "./pricing";

describe("pricing", () => {
  it("prices a known model per million tokens", () => expect(estimateCostUsd("claude-sonnet-5-5", 1_000_000, 1_000_000)).toBeCloseTo(18, 6));
  it("the fake provider is free", () => expect(estimateCostUsd("fake", 5000, 5000)).toBe(0));
  it("an unknown model is priced at the high fallback, never at zero", () => {
    expect(priceFor("brand-new-model")).toEqual({ price: FALLBACK_PRICE, known: false });
    expect(estimateCostUsd("brand-new-model", 1_000_000, 0)).toBeGreaterThan(estimateCostUsd("claude-sonnet-5-5", 1_000_000, 0));
  });
  it("approximates tokens from characters", () => expect(approxTokens(401)).toBe(101));
});

import { describe, expect, it } from "vitest";

import { canonDecimal, parseDecimal } from "./decimal";

describe("decimal", () => {
  it("canonicalises", () => {
    expect(canonDecimal("010.500")).toBe("10.5");
    expect(canonDecimal("-0.0")).toBe("0");
    expect(canonDecimal("100")).toBe("100");
    expect(canonDecimal("0.000001")).toBe("0.000001");
  });
  it("parses within bounds and rejects the rest", () => {
    expect(parseDecimal("1.5", { signed: false })).toBe("1.5");
    expect(parseDecimal(2, { signed: false })).toBe("2");
    expect(parseDecimal("-1", { signed: true })).toBe("-1");
    for (const bad of ["-1", "1e3", "1.1234567", "12345678901234", "", "abc", " ", NaN, Infinity, null, {}]) expect(parseDecimal(bad, { signed: false })).toBeNull();
    expect(parseDecimal(1e21, { signed: true })).toBeNull();
  });
});

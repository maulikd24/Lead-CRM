import { describe, expect, it } from "vitest";
import { currencyExponent, minorToMajor, parseMinorUnits } from "./money";

describe("currencyExponent", () => {
  it("knows two-decimal, zero-decimal and three-decimal currencies", () => {
    expect(currencyExponent("INR")).toBe(2);
    expect(currencyExponent("USD")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("KWD")).toBe(3);
  });
  it("falls back to 2 for a code it does not recognise", () => {
    expect(currencyExponent("XXZ9")).toBe(2);
  });
});

describe("parseMinorUnits", () => {
  it("converts decimal strings exactly, without float error", () => {
    expect(parseMinorUnits("123.45", "INR")).toBe(12345n);
    expect(parseMinorUnits("0.1", "INR")).toBe(10n);
    expect(parseMinorUnits("19.99", "USD")).toBe(1999n);
    expect(parseMinorUnits("1000", "INR")).toBe(100000n);
    expect(parseMinorUnits("0", "INR")).toBe(0n);
  });
  it("rounds half up beyond the currency precision", () => {
    expect(parseMinorUnits("1.005", "INR")).toBe(101n);
    expect(parseMinorUnits("1.004", "INR")).toBe(100n);
  });
  it("handles zero-decimal currencies", () => {
    expect(parseMinorUnits("1500", "JPY")).toBe(1500n);
  });
  it("rejects negative, empty or non-numeric input", () => {
    expect(() => parseMinorUnits("-1", "INR")).toThrow();
    expect(() => parseMinorUnits("", "INR")).toThrow();
    expect(() => parseMinorUnits("12abc", "INR")).toThrow();
  });
});

describe("minorToMajor", () => {
  it("divides by the currency exponent", () => {
    expect(minorToMajor(12345n, "INR")).toBe(123.45);
    expect(minorToMajor(1500, "JPY")).toBe(1500);
  });
});

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
    expect(parseMinorUnits("123.45", "INR")).toBe(BigInt(12345));
    expect(parseMinorUnits("0.1", "INR")).toBe(BigInt(10));
    expect(parseMinorUnits("19.99", "USD")).toBe(BigInt(1999));
    expect(parseMinorUnits("1000", "INR")).toBe(BigInt(100000));
    expect(parseMinorUnits("0", "INR")).toBe(BigInt(0));
  });
  it("rounds half up beyond the currency precision", () => {
    expect(parseMinorUnits("1.005", "INR")).toBe(BigInt(101));
    expect(parseMinorUnits("1.004", "INR")).toBe(BigInt(100));
  });
  it("handles zero-decimal currencies", () => {
    expect(parseMinorUnits("1500", "JPY")).toBe(BigInt(1500));
  });
  it("rejects negative, empty or non-numeric input", () => {
    expect(() => parseMinorUnits("-1", "INR")).toThrow();
    expect(() => parseMinorUnits("", "INR")).toThrow();
    expect(() => parseMinorUnits("12abc", "INR")).toThrow();
  });
});

describe("minorToMajor", () => {
  it("divides by the currency exponent", () => {
    expect(minorToMajor(BigInt(12345), "INR")).toBe(123.45);
    expect(minorToMajor(1500, "JPY")).toBe(1500);
  });
});

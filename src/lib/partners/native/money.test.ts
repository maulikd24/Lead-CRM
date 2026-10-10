import { describe, expect, it } from "vitest";

import { formatPaise, parseUnits, paiseToNumber, roundToPaise, sumUnits } from "./money";

describe("parseUnits (exact decimal, no floating point)", () => {
  it("reads decimal strings exactly", () => {
    expect(roundToPaise(parseUnits("123.45"))).toBe(12345n);
    expect(roundToPaise(parseUnits("-0.01"))).toBe(-1n);
    expect(roundToPaise(parseUnits("0"))).toBe(0n);
  });
  it("reads numbers, including ones JavaScript prints with an exponent", () => {
    expect(roundToPaise(parseUnits(1e21))).toBe(100000000000000000000000n);
    expect(roundToPaise(parseUnits(0.0000001))).toBe(0n);
    expect(roundToPaise(parseUnits(12.5))).toBe(1250n);
  });
  it("rejects what is not a number instead of returning zero", () => {
    expect(() => parseUnits("abc")).toThrow();
    expect(() => parseUnits("")).toThrow();
    expect(() => parseUnits(Number.NaN)).toThrow();
    expect(() => parseUnits(Infinity)).toThrow();
  });
});

describe("roundToPaise: half away from zero, once, on the exact value", () => {
  it.each([
    ["0.005", 1n],
    ["0.004999", 0n],
    ["1.005", 101n],
    ["2.675", 268n],
    ["-0.005", -1n],
    ["-1.005", -101n],
    ["-0.004999", 0n],
    ["10.2349999", 1023n],
    ["10.235", 1024n],
  ])("%s -> %s paise", (v, want) => expect(roundToPaise(parseUnits(v))).toBe(want));
});

describe("sumUnits", () => {
  it("adds exactly: ten times 0.1 is exactly 1", () => {
    expect(roundToPaise(sumUnits(Array.from({ length: 10 }, () => parseUnits("0.1"))))).toBe(100n);
  });
  it("sums an empty list to zero", () => {
    expect(sumUnits([])).toBe(0n);
  });
});

describe("formatting", () => {
  it("formats paise as a plain decimal string with two places", () => {
    expect(formatPaise(0n)).toBe("0.00");
    expect(formatPaise(5n)).toBe("0.05");
    expect(formatPaise(12345n)).toBe("123.45");
    expect(formatPaise(-1n)).toBe("-0.01");
    expect(formatPaise(-12345n)).toBe("-123.45");
  });
  it("converts to a number for display only", () => {
    expect(paiseToNumber(12345n)).toBe(123.45);
  });
});

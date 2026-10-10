import { describe, expect, it } from "vitest";

import { formatPaise, parseUnits, paiseToNumber, roundToPaise, sumUnits } from "./money";

describe("parseUnits (exact decimal, no floating point)", () => {
  it("reads decimal strings exactly", () => {
    expect(roundToPaise(parseUnits("123.45"))).toBe(BigInt(12345));
    expect(roundToPaise(parseUnits("-0.01"))).toBe(-BigInt(1));
    expect(roundToPaise(parseUnits("0"))).toBe(BigInt(0));
  });
  it("reads numbers, including ones JavaScript prints with an exponent", () => {
    expect(roundToPaise(parseUnits(1e21))).toBe(BigInt("100000000000000000000000"));
    expect(roundToPaise(parseUnits(0.0000001))).toBe(BigInt(0));
    expect(roundToPaise(parseUnits(12.5))).toBe(BigInt(1250));
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
    ["0.005", BigInt(1)],
    ["0.004999", BigInt(0)],
    ["1.005", BigInt(101)],
    ["2.675", BigInt(268)],
    ["-0.005", -BigInt(1)],
    ["-1.005", -BigInt(101)],
    ["-0.004999", BigInt(0)],
    ["10.2349999", BigInt(1023)],
    ["10.235", BigInt(1024)],
  ])("%s -> %s paise", (v, want) => expect(roundToPaise(parseUnits(v))).toBe(want));
});

describe("sumUnits", () => {
  it("adds exactly: ten times 0.1 is exactly 1", () => {
    expect(roundToPaise(sumUnits(Array.from({ length: 10 }, () => parseUnits("0.1"))))).toBe(BigInt(100));
  });
  it("sums an empty list to zero", () => {
    expect(sumUnits([])).toBe(BigInt(0));
  });
});

describe("formatting", () => {
  it("formats paise as a plain decimal string with two places", () => {
    expect(formatPaise(BigInt(0))).toBe("0.00");
    expect(formatPaise(BigInt(5))).toBe("0.05");
    expect(formatPaise(BigInt(12345))).toBe("123.45");
    expect(formatPaise(-BigInt(1))).toBe("-0.01");
    expect(formatPaise(-BigInt(12345))).toBe("-123.45");
  });
  it("converts to a number for display only", () => {
    expect(paiseToNumber(BigInt(12345))).toBe(123.45);
  });
});

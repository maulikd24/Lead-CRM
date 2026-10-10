import { describe, expect, it } from "vitest";

import { formatPaise, formatUnits, parseRate, parseUnits, paiseToNumber, ratePaise, roundToPaise, sumUnits } from "./money";

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

describe("parseRate: a percentage with at most four decimals, held as an integer", () => {
  it("reads whole and fractional percentages exactly", () => {
    expect(parseRate("10")).toBe(BigInt(100000));
    expect(parseRate("3.75")).toBe(BigInt(37500));
    expect(parseRate("0.0001")).toBe(BigInt(1));
    expect(parseRate(" 18.0000 ")).toBe(BigInt(180000));
  });
  it("rejects what cannot be an exact rate instead of rounding it", () => {
    for (const bad of ["", "abc", "-1", "1.00001", "1e2", "100.0001", "101"]) expect(() => parseRate(bad), bad).toThrow();
  });
  it("allows 100 exactly and zero", () => {
    expect(parseRate("100")).toBe(BigInt(1000000));
    expect(parseRate("0")).toBe(BigInt(0));
  });
});

describe("ratePaise: units times a rate, rounded once to paise, half away from zero", () => {
  it("is exact where floating point is not", () => {
    // 0.1 + 0.2 style traps: 10% of 0.07 rupees is 0.007, rounds to 1 paisa; 10% of 0.04 is 0.4 paisa, rounds to 0.
    expect(ratePaise(parseUnits("0.07"), parseRate("10"))).toBe(BigInt(1));
    expect(ratePaise(parseUnits("0.04"), parseRate("10"))).toBe(BigInt(0));
  });
  it("rounds ties away from zero on both signs", () => {
    // 5% of 0.10 rupees = 0.005 rupees = exactly half a paisa.
    expect(ratePaise(parseUnits("0.10"), parseRate("5"))).toBe(BigInt(1));
    expect(ratePaise(parseUnits("-0.10"), parseRate("5"))).toBe(-BigInt(1));
  });
  it("handles a large amount without losing a paisa", () => {
    expect(ratePaise(parseUnits("123456789012.34"), parseRate("10"))).toBe(BigInt("1234567890123"));
    expect(ratePaise(parseUnits("999999999.99"), parseRate("18"))).toBe(BigInt("18000000000"));
  });
  it("a rate of zero is zero", () => {
    expect(ratePaise(parseUnits("1000"), parseRate("0"))).toBe(BigInt(0));
  });
});

describe("formatUnits: exact units back to a plain decimal string", () => {
  it("drops trailing zeros and keeps the sign", () => {
    expect(formatUnits(parseUnits("200"))).toBe("200");
    expect(formatUnits(parseUnits("1.50"))).toBe("1.5");
    expect(formatUnits(parseUnits("-0.00000001"))).toBe("-0.00000001");
    expect(formatUnits(BigInt(0))).toBe("0");
    expect(formatUnits(parseUnits("123456789012.34567891"))).toBe("123456789012.34567891");
  });
  it("round-trips what parseUnits read, and a string with a long zero tail", () => {
    expect(formatUnits(parseUnits("200.000000000000000000000000000000"))).toBe("200");
  });
});

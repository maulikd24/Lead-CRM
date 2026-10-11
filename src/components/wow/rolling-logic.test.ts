import { describe, expect, it } from "vitest";

import { ROLL_MAX_MS, rollDelayMs, splitRolling } from "./rolling-logic";

describe("splitRolling", () => {
  it("splits a formatted number into rolling digits and fixed characters", () => {
    expect(splitRolling("1,234")).toEqual([
      { kind: "digit", digit: 1 },
      { kind: "fixed", char: "," },
      { kind: "digit", digit: 2 },
      { kind: "digit", digit: 3 },
      { kind: "digit", digit: 4 },
    ]);
  });
  it("keeps currency, percent and decimals as fixed characters", () => {
    expect(splitRolling("₹9.5%").map((p) => (p.kind === "fixed" ? p.char : p.digit))).toEqual(["₹", 9, ".", 5, "%"]);
  });
  it("is empty for an empty string", () => {
    expect(splitRolling("")).toEqual([]);
  });
});

describe("rollDelayMs", () => {
  it("staggers from the right so the units settle last, and never pushes the whole roll past the 300ms ceiling", () => {
    expect(ROLL_MAX_MS).toBeLessThanOrEqual(300);
    for (const n of [1, 3, 8, 12]) {
      for (let i = 0; i < n; i++) expect(rollDelayMs(i, n) + ROLL_MAX_MS * 0.8).toBeLessThanOrEqual(300);
    }
    expect(rollDelayMs(0, 3)).toBeLessThan(rollDelayMs(2, 3));
  });
});

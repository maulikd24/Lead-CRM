import { describe, expect, it } from "vitest";
import { formatInrCompact } from "./format";

describe("formatInrCompact", () => {
  it("abbreviates lakh and crore", () => {
    expect(formatInrCompact(250000)).toBe("₹2.50 L");
    expect(formatInrCompact(25000000)).toBe("₹2.50 Cr");
    expect(formatInrCompact(1234)).toBe("₹1,234");
  });
  it("rolls over at the unit boundary instead of showing 100.00 L", () => {
    expect(formatInrCompact(9999999)).toBe("₹1.00 Cr");
    expect(formatInrCompact(99999)).toBe("₹1.00 L");
  });
  it("puts the sign before the symbol", () => {
    expect(formatInrCompact(-500000)).toBe("-₹5.00 L");
    expect(formatInrCompact(-1234)).toBe("-₹1,234");
  });
  it("shows a dash for non-finite input", () => {
    expect(formatInrCompact(NaN)).toBe("—");
    expect(formatInrCompact(Infinity)).toBe("—");
  });
});

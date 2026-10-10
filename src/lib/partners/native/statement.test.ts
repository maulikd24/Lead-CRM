import { describe, expect, it } from "vitest";

import { buildStatement, type StatementInput } from "./statement";

const line = (id: string, amount: string, date = "2026-09-05T00:00:00.000Z") => ({ id, date, revenueType: "BROKERAGE", clientCode: "CL-00001", amount });
const adj = (id: string, amount: string, reason = "Clawback") => ({ id, date: "2026-09-20T00:00:00.000Z", reason, amount });

describe("buildStatement", () => {
  it("totals lines, adjustments and net payable to the paisa", () => {
    const s = buildStatement({ lines: [line("a", "100.10"), line("b", "200.20")], adjustments: [adj("x", "-50.05")], stored: null });
    expect(s.grossPaise).toBe(BigInt(30030));
    expect(s.adjustmentsPaise).toBe(-BigInt(5005));
    expect(s.netPaise).toBe(BigInt(25025));
    expect(s.gross).toBe("300.30");
    expect(s.net).toBe("250.25");
  });

  it("rounds the total once, on exact figures, and shows the rounding as its own line", () => {
    // three accruals of 0.004 each: every line rounds to 0.00, but the exact total 0.012 is 0.01.
    const s = buildStatement({ lines: [line("a", "0.004"), line("b", "0.004"), line("c", "0.004")], adjustments: [], stored: null });
    expect(s.lines.map((l) => l.amount)).toEqual(["0.00", "0.00", "0.00"]);
    expect(s.grossPaise).toBe(BigInt(1));
    expect(s.roundingPaise).toBe(BigInt(1));
    // the shown lines plus the rounding line always equal the total
    expect(s.lines.reduce((a, l) => a + l.amountPaise, BigInt(0)) + s.roundingPaise).toBe(s.grossPaise);
  });

  it("has a zero rounding line when the amounts are already in paise", () => {
    const s = buildStatement({ lines: [line("a", "10.01"), line("b", "20.02")], adjustments: [], stored: null });
    expect(s.roundingPaise).toBe(BigInt(0));
  });

  it("a statement with nothing on it is all zeros, not an error", () => {
    const s = buildStatement({ lines: [], adjustments: [], stored: null });
    expect([s.gross, s.adjustmentsTotal, s.net]).toEqual(["0.00", "0.00", "0.00"]);
  });

  it("does not hide a negative net: clawbacks can exceed accruals", () => {
    const s = buildStatement({ lines: [line("a", "10.00")], adjustments: [adj("x", "-25.00")], stored: null });
    expect(s.netPaise).toBe(-BigInt(1500));
    expect(s.negativeNet).toBe(true);
  });

  it("agrees with the stored payout when it matches to the paisa", () => {
    const s = buildStatement({ lines: [line("a", "100.004"), line("b", "50.004")], adjustments: [adj("x", "-10")], stored: { totalAccrual: "150.008", adjustment: "-10", net: "140.008" } });
    expect(s.stored).toEqual({ matches: true, net: "140.01", gross: "150.01", adjustments: "-10.00" });
  });

  it("reports a stored payout that disagrees, with both figures", () => {
    const s = buildStatement({ lines: [line("a", "100")], adjustments: [], stored: { totalAccrual: "90", adjustment: "0", net: "90" } });
    expect(s.stored!.matches).toBe(false);
    expect(s.stored!.net).toBe("90.00");
    expect(s.net).toBe("100.00");
  });

  it("orders lines by date then id so the same data always prints the same", () => {
    const s = buildStatement({ lines: [line("b", "1", "2026-09-06T00:00:00.000Z"), line("a", "1", "2026-09-06T00:00:00.000Z"), line("c", "1", "2026-09-01T00:00:00.000Z")], adjustments: [], stored: null });
    expect(s.lines.map((l) => l.id)).toEqual(["c", "a", "b"]);
  });

  it("states what it does not compute: no tax is modelled", () => {
    const s = buildStatement({ lines: [], adjustments: [], stored: null });
    expect(s.assumptions.join(" ")).toMatch(/TDS/);
    expect(s.assumptions.join(" ")).toMatch(/GST/);
    expect(s.assumptions.join(" ")).toMatch(/not (calculated|computed|modelled)/i);
  });

  it("is a pure function of its input", () => {
    const input: StatementInput = { lines: [line("a", "1.005")], adjustments: [], stored: null };
    expect(buildStatement(input)).toEqual(buildStatement(input));
  });

  it("throws on an amount that is not a number rather than counting it as zero", () => {
    expect(() => buildStatement({ lines: [line("a", "oops")], adjustments: [], stored: null })).toThrow();
  });
});

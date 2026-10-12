import { describe, expect, it } from "vitest";

import { leaderboardFor, parseQuarterKey, quarterOf, quarterProgress, rankRows, shiftQuarter } from "./quarter";

describe("quarters", () => {
  it("knows the calendar quarter of a date", () => {
    const q = quarterOf(new Date(2026, 9, 12));
    expect(q.key).toBe("2026-Q4");
    expect(q.label).toBe("Q4 2026");
    expect(q.start).toEqual(new Date(2026, 9, 1));
    expect(q.end.getMonth()).toBe(11);
  });
  it("parses keys and rejects anything else", () => {
    expect(parseQuarterKey("2027-Q1")?.start).toEqual(new Date(2027, 0, 1));
    expect(parseQuarterKey("2027-Q5")).toBeNull();
    expect(parseQuarterKey("Q1")).toBeNull();
    expect(parseQuarterKey(undefined)).toBeNull();
  });
  it("steps across year ends", () => {
    expect(shiftQuarter(quarterOf(new Date(2026, 10, 1)), 1).key).toBe("2027-Q1");
    expect(shiftQuarter(quarterOf(new Date(2026, 1, 1)), -1).key).toBe("2025-Q4");
  });
});

describe("quarterProgress", () => {
  const q = quarterOf(new Date(2026, 9, 1)); // 1 Oct – 31 Dec, 92 days
  it("works out the share, what's left and the daily pace needed", () => {
    const p = quarterProgress(4_000_000, 10_000_000, q, new Date(2026, 11, 22, 15));
    expect(p.pct).toBe(40);
    expect(p.remaining).toBe(6_000_000);
    expect(p.daysLeft).toBe(10); // 22–31 Dec, today included
    expect(p.perDayNeeded).toBe(600_000);
  });
  it("needs nothing more once the target is met", () => {
    const p = quarterProgress(12_000_000, 10_000_000, q, new Date(2026, 10, 1));
    expect(p.pct).toBe(120);
    expect(p.remaining).toBe(0);
    expect(p.perDayNeeded).toBeNull();
  });
  it("has no share or pace without a target", () => {
    expect(quarterProgress(5, 0, q, new Date(2026, 10, 1))).toMatchObject({ pct: null, perDayNeeded: null });
  });
  it("counts no days left after the quarter and the whole quarter before it", () => {
    expect(quarterProgress(0, 10, q, new Date(2027, 0, 5)).daysLeft).toBe(0);
    expect(quarterProgress(0, 10, q, new Date(2026, 8, 1)).daysLeft).toBe(92);
  });
});

describe("leaderboard", () => {
  const rows = [
    { rmId: "a", name: "Asha", funded: 500, target: 1000 },
    { rmId: "b", name: "Bilal", funded: 900, target: 1000 },
    { rmId: "c", name: "Chitra", funded: 500, target: 800 },
    { rmId: "d", name: "Dev", funded: 100, target: 1000 },
  ];
  it("ranks by funded amount, ties sharing a rank", () => {
    expect(rankRows(rows).map((r) => [r.rmId, r.rank])).toEqual([["b", 1], ["a", 2], ["c", 2], ["d", 4]]);
  });
  it("shows Managers and Admins every RM in their scope", () => {
    const view = leaderboardFor({ id: "m", role: "MANAGER" }, rows.slice(0, 2), rows);
    expect(view.kind === "team" && view.rows.map((r) => r.rmId)).toEqual(["b", "a"]);
  });
  it("shows an RM only their own row and their rank among all RMs", () => {
    const view = leaderboardFor({ id: "c", role: "RM" }, rows.filter((r) => r.rmId === "c"), rows);
    expect(view).toEqual({ kind: "self", row: { rmId: "c", name: "Chitra", funded: 500, target: 800, rank: 2 }, of: 4 });
    expect(JSON.stringify(view)).not.toContain("Bilal");
  });
});

import { describe, expect, it } from "vitest";
import { chooseSurvivor, holderConflict, planMerge, type SideFacts } from "./plan";

const side = (over: Partial<SideFacts> = {}): SideFacts => ({
  id: "a",
  pan: null,
  kycStarted: false,
  kycCompleted: false,
  hasKycRecord: false,
  hasFundingRecord: false,
  hasDealerIntro: false,
  holders: [],
  completeness: 0,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  counts: { documents: 0, tasks: 0, activities: 0, calls: 0, payments: 0, stageHistory: 0, exceptions: 0, tradingAccounts: 0, revenueEvents: 0, messages: 0, positions: 0, holdings: 0, kycSteps: 0, opportunities: 0, householdMemberships: 0, journeyRuns: 0 },
  ...over,
});

describe("chooseSurvivor", () => {
  it("prefers the record with a PAN", () => {
    const r = chooseSurvivor(side({ id: "a" }), side({ id: "b", pan: "ABCDE1234F" }));
    expect(r.survivorId).toBe("b");
    expect(r.why).toMatch(/PAN/);
  });
  it("then the more complete KYC, then the more complete profile, then the older record", () => {
    expect(chooseSurvivor(side({ id: "a" }), side({ id: "b", kycCompleted: true })).survivorId).toBe("b");
    expect(chooseSurvivor(side({ id: "a", kycStarted: true }), side({ id: "b" })).survivorId).toBe("a");
    expect(chooseSurvivor(side({ id: "a", completeness: 3 }), side({ id: "b", completeness: 5 })).survivorId).toBe("b");
    expect(chooseSurvivor(side({ id: "a", createdAt: new Date("2026-03-01") }), side({ id: "b", createdAt: new Date("2026-02-01") })).survivorId).toBe("b");
  });
  it("is symmetric", () => {
    const x = side({ id: "x", completeness: 2 });
    const y = side({ id: "y", completeness: 4 });
    expect(chooseSurvivor(x, y).survivorId).toBe(chooseSurvivor(y, x).survivorId);
  });
});

describe("holderConflict", () => {
  it("allows no duplicate holders", () => expect(holderConflict([{ position: "SECOND" }], [])).toBeNull());
  it("blocks more than 2 extra holders in total", () => {
    expect(holderConflict([{ position: "SECOND" }, { position: "THIRD" }], [{ position: null }])).toMatch(/3-holder limit/);
  });
  it("blocks a colliding position", () => {
    expect(holderConflict([{ position: "SECOND" }], [{ position: "SECOND" }])).toMatch(/second holder/);
  });
  it("allows non-colliding holders", () => expect(holderConflict([{ position: "SECOND" }], [{ position: "THIRD" }])).toBeNull());
});

describe("planMerge", () => {
  it("blocks two different PANs, whatever else is true", () => {
    const p = planMerge(side({ id: "s", pan: "ABCDE1234F" }), side({ id: "d", pan: "ZZZZZ9999Z" }));
    expect(p.blocked).toMatch(/different PAN/i);
  });
  it("PAN comparison ignores case and whitespace", () => {
    expect(planMerge(side({ pan: "abcde1234f" }), side({ id: "d", pan: " ABCDE1234F " })).blocked).toBeNull();
  });
  it("blocks when only the archived side has a PAN, telling the reviewer to flip", () => {
    const p = planMerge(side({ id: "s" }), side({ id: "d", pan: "ABCDE1234F" }));
    expect(p.blocked).toMatch(/Keep the record that has the PAN/);
  });
  it("blocks the same record on both sides", () => expect(planMerge(side({ id: "x" }), side({ id: "x" })).blocked).toMatch(/itself/));
  it("lists what moves (non-zero only) and what stays", () => {
    const p = planMerge(
      side({ id: "s", hasKycRecord: true }),
      side({ id: "d", hasKycRecord: true, hasFundingRecord: true, counts: { ...side().counts, activities: 4, messages: 2, holdings: 1 } }),
    );
    expect(p.blocked).toBeNull();
    expect(p.moves).toEqual([
      { key: "activities", label: "Activities", count: 4 },
      { key: "messages", label: "Messages", count: 2 },
      { key: "fundingRecord", label: "Funding record", count: 1 },
    ]);
    expect(p.stays.map((s) => s.key)).toEqual(["kycRecord", "holdings"]);
  });
  it("carries holder conflicts as a block", () => {
    const p = planMerge(side({ id: "s", holders: [{ position: "SECOND" }] }), side({ id: "d", holders: [{ position: "SECOND" }] }));
    expect(p.blocked).toMatch(/second holder/);
  });
});

describe("planMerge: app user ids", () => {
  const opts = { linkAppIds: true };
  it("says nothing when neither side has an app user id", () => {
    const p = planMerge(side({ id: "s" }), side({ id: "d" }), opts);
    expect(p.appIds).toEqual({ state: "none", notice: null });
    expect(p.moves.find((m) => m.key === "appSignups")).toBeUndefined();
  });
  it("moves the archived side's app signup records to the survivor when linking is on", () => {
    const p = planMerge(side({ id: "s" }), side({ id: "d", appUserIds: ["x"] }), opts);
    expect(p.moves).toContainEqual({ key: "appSignups", label: "App signup records", count: 1 });
    expect(p.appIds.state).toBe("single");
    expect(p.appIds.notice).toBeNull();
  });
  it("leaves them behind (and says so) when linking is off", () => {
    const p = planMerge(side({ id: "s" }), side({ id: "d", appUserIds: ["x"] }));
    expect(p.moves.find((m) => m.key === "appSignups")).toBeUndefined();
    expect(p.stays).toContainEqual({ key: "appSignups", label: "App signup records", count: 1 });
  });
  it("flags two different app user ids: both stay findable, CleverTap is not written", () => {
    const p = planMerge(side({ id: "s", appUserIds: ["a"] }), side({ id: "d", appUserIds: ["b"] }), opts);
    expect(p.appIds.state).toBe("conflict");
    expect(p.appIds.notice).toMatch(/two different app user ids/i);
    expect(p.appIds.notice).toMatch(/both stay/i);
    expect(p.appIds.notice).toMatch(/nothing is written to CleverTap/i);
    expect(p.blocked).toBeNull();
  });
  it("the same app user id on both sides is not a conflict", () => {
    expect(planMerge(side({ id: "s", appUserIds: ["a"] }), side({ id: "d", appUserIds: ["a"] }), opts).appIds.state).toBe("single");
  });
  it("does not show the conflict notice when linking is off (the merge will not touch the ledger)", () => {
    expect(planMerge(side({ id: "s", appUserIds: ["a"] }), side({ id: "d", appUserIds: ["b"] })).appIds.notice).toBeNull();
  });
});

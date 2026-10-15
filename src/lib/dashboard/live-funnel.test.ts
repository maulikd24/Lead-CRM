import { describe, expect, it } from "vitest";

import { buildFunnelStages, risenStages, nextPollDelay, shouldCelebrateOwn, firstName } from "./live-funnel";

const totals = { leads: 100, kyc: 40, funded: 20, activated: 10 };

describe("buildFunnelStages", () => {
  it("adds a contacted stage from lifecycle counts and computes conversion from the previous stage", () => {
    const s = buildFunnelStages(totals, { Lead: 30, Contacted: 20, KYC: 20, Funded: 10, Activated: 10, Lost: 10 });
    expect(s.map((x) => x.key)).toEqual(["leads", "contacted", "kyc", "funded", "activated"]);
    expect(s[1].count).toBe(60); // 100 - Lead 30 - Lost 10
    expect(s[0].conversion).toBeNull();
    expect(s[1].conversion).toBe(60);
    expect(s[2].conversion).toBe(67); // 40/60
    expect(s[3].conversion).toBe(50);
  });
  it("omits contacted when lifecycle data is missing and clamps it between kyc and leads", () => {
    expect(buildFunnelStages(totals, {}).map((x) => x.key)).toEqual(["leads", "kyc", "funded", "activated"]);
    const s = buildFunnelStages(totals, { Lead: 95, Lost: 4 });
    expect(s[1].count).toBe(40);
  });
  it("handles zero leads without dividing by zero", () => {
    const s = buildFunnelStages({ leads: 0, kyc: 0, funded: 0, activated: 0 }, {});
    expect(s.every((x) => x.conversion === null || x.conversion === 0)).toBe(true);
    expect(s[0].share).toBe(0);
  });
});

describe("risenStages", () => {
  it("lists stage keys whose count went up", () => {
    expect(risenStages({ leads: 5, kyc: 2, funded: 1, activated: 0 }, { leads: 7, kyc: 2, funded: 2, activated: 0 })).toEqual(["leads", "funded"]);
    expect(risenStages({ leads: 5, kyc: 2, funded: 1, activated: 0 }, { leads: 4, kyc: 2, funded: 1, activated: 0 })).toEqual([]);
  });
});

describe("nextPollDelay", () => {
  it("is the base interval when healthy and backs off, capped, on failures", () => {
    expect(nextPollDelay(0)).toBe(20000);
    expect(nextPollDelay(1)).toBe(40000);
    expect(nextPollDelay(2)).toBe(80000);
    expect(nextPollDelay(9)).toBe(120000);
  });
});

describe("shouldCelebrateOwn", () => {
  const sessionStart = Date.parse("2026-10-12T09:00:00Z");
  const me = "user-me";
  const none = new Set<string>();
  const ev = (over: Partial<{ id: string; actorUserId: string; atMs: number }> = {}) => ({
    id: "c1",
    actorUserId: me,
    atMs: sessionStart + 60_000,
    ...over,
  });
  it("celebrates the viewer's own completion made after the session started", () => {
    expect(shouldCelebrateOwn(ev(), me, sessionStart, none)).toBe(true);
  });
  it("never celebrates another person's completion, even one made in this session", () => {
    expect(shouldCelebrateOwn(ev({ actorUserId: "rm-other" }), me, sessionStart, none)).toBe(false);
  });
  it("never celebrates on login: completions from before the session started are ignored", () => {
    expect(shouldCelebrateOwn(ev({ atMs: sessionStart - 1 }), me, sessionStart, none)).toBe(false);
  });
  it("is once per id within the session", () => {
    const seen = new Set<string>(["c1"]);
    expect(shouldCelebrateOwn(ev(), me, sessionStart, seen)).toBe(false);
    expect(shouldCelebrateOwn(ev({ id: "c2" }), me, sessionStart, seen)).toBe(true);
  });
});

describe("firstName", () => {
  it("returns only the first name", () => {
    expect(firstName("Asha Verma")).toBe("Asha");
    expect(firstName("  ")).toBe("");
  });
});

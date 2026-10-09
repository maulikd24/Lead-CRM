import { describe, expect, it } from "vitest";

import { buildFunnelStages, risenStages, nextPollDelay, decideCelebration, firstName } from "./live-funnel";

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

describe("decideCelebration", () => {
  const now = new Date("2026-10-09T10:00:00Z");
  const latest = { id: "c1", firstName: "Asha", atIso: "2026-10-09T08:00:00Z" };
  it("celebrates a fresh funded customer not yet seen", () => {
    expect(decideCelebration(latest, null, now)).toEqual({ celebrate: true, record: "c1" });
  });
  it("is once per customer", () => {
    expect(decideCelebration(latest, "c1", now)).toEqual({ celebrate: false, record: "c1" });
  });
  it("does not celebrate stale history on first visit but records it", () => {
    expect(decideCelebration({ ...latest, atIso: "2026-09-01T00:00:00Z" }, null, now)).toEqual({ celebrate: false, record: "c1" });
  });
  it("does nothing without a funded customer", () => {
    expect(decideCelebration(null, null, now)).toEqual({ celebrate: false, record: null });
  });
});

describe("firstName", () => {
  it("returns only the first name", () => {
    expect(firstName("Asha Verma")).toBe("Asha");
    expect(firstName("  ")).toBe("");
  });
});

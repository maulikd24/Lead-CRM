import { describe, expect, it } from "vitest";

import { buildClientRail } from "./client-rail-model";

const base = {
  stageName: "KYC completed",
  ageHours: 50,
  slaStatus: "DUE_SOON" as const,
  nba: { label: "Collect funds", detail: "KYC is done; ask for the first deposit." },
  openTickets: 2,
  kyc: "APPROVED",
  funding: null,
  dealer: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  stageEnteredAt: new Date("2026-10-08T00:00:00Z"),
  daysSinceLastActivity: 3,
  nextActionTitle: "Call back",
  nextActionDueAt: new Date("2026-10-12T00:00:00Z"),
};

describe("client record rail model", () => {
  it("leads with stage, time in stage and SLA, then the next step and open tickets", () => {
    const r = buildClientRail(base);
    expect(r.facts.map((f) => f.key)).toEqual(["stage", "sla", "next", "tickets"]);
    expect(r.facts[0]).toMatchObject({ value: "KYC completed", hint: "2d in this stage" });
    expect(r.facts[1]).toMatchObject({ value: "DUE SOON", tone: "warning" });
    expect(r.facts[2]).toMatchObject({ value: "Collect funds", hint: "KYC is done; ask for the first deposit." });
    expect(r.facts[3]).toMatchObject({ count: 2, tone: "warning" });
  });
  it("maps SLA tone: overdue is destructive, on track is success, not applicable is neutral", () => {
    expect(buildClientRail({ ...base, slaStatus: "OVERDUE" }).facts[1].tone).toBe("destructive");
    expect(buildClientRail({ ...base, slaStatus: "ON_TRACK" }).facts[1].tone).toBe("success");
    expect(buildClientRail({ ...base, slaStatus: "NOT_APPLICABLE" }).facts[1].tone).toBe("default");
  });
  it("no open tickets is a calm zero", () => {
    const t = buildClientRail({ ...base, openTickets: 0 }).facts[3];
    expect(t).toMatchObject({ count: 0, tone: "default", hint: "None open" });
  });
  it("onboarding chips say where each step stands and which tab holds it", () => {
    const r = buildClientRail({ ...base, funding: "FULLY_FUNDED" });
    expect(r.onboarding).toEqual([
      { key: "kyc", label: "KYC: APPROVED", tab: "onboarding" },
      { key: "funding", label: "Funding: FULLY_FUNDED", tab: "funding" },
      { key: "dealer", label: "Dealer: Not started", tab: "funding" },
    ]);
    expect(buildClientRail({ ...base, kyc: null }).onboarding[0].label).toBe("KYC: Not started");
  });
  it("key dates: created, in stage since, last activity and the next action", () => {
    const d = buildClientRail(base).dates;
    expect(d.map((x) => x.label)).toEqual(["Created", "In stage since", "Last activity", "Next action due"]);
    expect(d[2].value).toBe("3 days ago");
    expect(d[3].hint).toBe("Call back");
  });
  it("last activity wording and a missing next action", () => {
    expect(buildClientRail({ ...base, daysSinceLastActivity: 0 }).dates[2].value).toBe("Today");
    expect(buildClientRail({ ...base, daysSinceLastActivity: 1 }).dates[2].value).toBe("Yesterday");
    const none = buildClientRail({ ...base, nextActionDueAt: null, nextActionTitle: null }).dates;
    expect(none.find((x) => x.label === "Next action due")?.value).toBe("Not set");
  });
});

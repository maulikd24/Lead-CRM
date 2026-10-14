import { describe, expect, it } from "vitest";

import { buildClientRail } from "./client-rail-model";

const base = {
  ageHours: 50,
  slaStatus: "DUE_SOON" as const,
  openTickets: 2,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  stageEnteredAt: new Date("2026-10-08T00:00:00Z"),
  daysSinceLastActivity: 3,
  nextActionTitle: "Call back",
  nextActionDueAt: new Date("2026-10-12T00:00:00Z"),
};

describe("client record rail model", () => {
  it("shows time in stage, SLA and open tickets: the stage name and next step live elsewhere on the page", () => {
    const r = buildClientRail(base);
    expect(r.facts.map((f) => f.key)).toEqual(["stage", "sla", "tickets"]);
    expect(r.facts[0]).toMatchObject({ label: "Time in stage", value: "2d" });
    expect(r.facts[1]).toMatchObject({ value: "DUE SOON", tone: "warning" });
    expect(r.facts[2]).toMatchObject({ count: 2, tone: "warning" });
  });
  it("maps SLA tone: overdue is destructive, on track is success, not applicable is neutral", () => {
    expect(buildClientRail({ ...base, slaStatus: "OVERDUE" }).facts[1].tone).toBe("destructive");
    expect(buildClientRail({ ...base, slaStatus: "ON_TRACK" }).facts[1].tone).toBe("success");
    expect(buildClientRail({ ...base, slaStatus: "NOT_APPLICABLE" }).facts[1].tone).toBe("default");
  });
  it("no open tickets is a calm zero", () => {
    const t = buildClientRail({ ...base, openTickets: 0 }).facts[2];
    expect(t).toMatchObject({ count: 0, tone: "default", hint: "None open" });
  });
  it("has no onboarding box: KYC, funding and dealer status are in the stage tracker and their own tabs", () => {
    expect(Object.keys(buildClientRail(base))).toEqual(["facts", "dates"]);
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

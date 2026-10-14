import { describe, expect, it } from "vitest";

import { buildClientRail } from "./client-rail-model";

const base = {
  ageHours: 50,
  slaStatus: "DUE_SOON" as const,
  openTickets: 2,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  daysSinceLastActivity: 3,
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
  it("key dates: created and last activity only. Stage age is the one stage fact and the next step is only in the header", () => {
    const d = buildClientRail(base).dates;
    expect(d.map((x) => x.label)).toEqual(["Created", "Last activity"]);
    expect(d[1].value).toBe("3 days ago");
  });
  it("last activity wording", () => {
    expect(buildClientRail({ ...base, daysSinceLastActivity: 0 }).dates[1].value).toBe("Today");
    expect(buildClientRail({ ...base, daysSinceLastActivity: 1 }).dates[1].value).toBe("Yesterday");
  });
});

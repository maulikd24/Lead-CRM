import { describe, expect, it } from "vitest";

import { buildLeakage } from "./leakage";
import { buildImpact, type ImpactClient } from "./impact";
import type { CustomerLine } from "./impact-db";

const NOW = new Date("2027-04-20T06:00:00Z");
let n = 0;
const client = (over: Partial<ImpactClient> = {}): ImpactClient => ({
  clientId: `c${++n}`, name: `Customer ${n}`, rmId: "rm1", rmName: "Karan Mehta", stage: "New Lead", createdAt: new Date("2027-04-10T05:00:00Z"), leadMonth: "2027-04",
  group: { key: "meta:111", label: "Retirement Planning", kind: "campaign" }, creative: null, confidence: "high", contact: "missed", firstContactMinutes: null,
  kycApproved: false, funded: false, revenue: 0, revenueByMonth: {}, ...over,
});
const line = (c: ImpactClient): CustomerLine => ({ clientId: c.clientId, name: c.name, rmName: c.rmName, stage: c.stage, leadDate: "2027-04-10", funded: c.funded, kycApproved: c.kycApproved, revenue: c.revenue, confidence: c.confidence, contact: c.contact, createdAtIso: c.createdAt.toISOString() });

describe("buildLeakage: leads nobody reached, past their SLA, by campaign", () => {
  const clients = [
    client(),
    client({ createdAt: new Date("2027-04-19T05:00:00Z") }),
    client({ rmName: null, rmId: null, group: { key: "meta:222", label: "ELSS Tax Saving", kind: "campaign" } }),
    client({ contact: "in_sla", firstContactMinutes: 5 }),
    client({ contact: "late", firstContactMinutes: 80 }),
    client({ contact: "pending", createdAt: new Date("2027-04-20T05:55:00Z") }),
    client({ group: { key: "unattributed", label: "Unattributed", kind: "unattributed" }, confidence: null }),
  ];
  const report = buildImpact({ clients, spend: [], slaMinutes: 15, currency: "INR" });
  const customers: Record<string, CustomerLine[]> = {};
  for (const c of clients) (customers[c.group.key] ??= []).push(line(c));
  const view = buildLeakage({ report, customers, slaMinutes: 15, now: NOW });

  it("counts only leads that were never reached and whose window has passed", () => {
    expect(view.total).toBe(4);
    expect(view.groups.map((g) => [g.key, g.missed])).toEqual([["meta:111", 2], ["meta:222", 1], ["unattributed", 1]]);
  });

  it("gives the share of each campaign's leads that leaked, leaving out leads still inside their window", () => {
    const g = view.groups.find((x) => x.key === "meta:111")!;
    expect(g.leads).toBe(5);
    expect(g.leakRate).toBeCloseTo(2 / 4);
  });

  it("lists the leaked leads most overdue first, with how long past the SLA", () => {
    const g = view.groups.find((x) => x.key === "meta:111")!;
    expect(g.items).toHaveLength(2);
    expect(g.items[0].minutesPastSla).toBeGreaterThan(g.items[1].minutesPastSla);
    expect(g.items[1].minutesPastSla).toBe(Math.round((NOW.getTime() - new Date("2027-04-19T05:00:00Z").getTime()) / 60_000) - 15);
    expect(g.oldestMinutesPastSla).toBe(g.items[0].minutesPastSla);
  });

  it("splits the leaks by RM, with unassigned as its own line", () => {
    expect(view.byRm).toEqual([{ rmName: "Karan Mehta", missed: 3 }, { rmName: "Unassigned", missed: 1 }]);
  });

  it("nothing leaked is an empty view, not an error", () => {
    const empty = buildLeakage({ report: buildImpact({ clients: [], spend: [], slaMinutes: 15, currency: "INR" }), customers: {}, slaMinutes: 15, now: NOW });
    expect(empty).toEqual({ total: 0, groups: [], byRm: [] });
  });
});

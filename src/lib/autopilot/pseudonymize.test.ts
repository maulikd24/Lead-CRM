import { describe, expect, it } from "vitest";

import { demoSnapshot } from "./fixture";
import { pseudonymize } from "./pseudonymize";
import { sum } from "./stats";

describe("pseudonymize", () => {
  it("blurs per-person values and times but keeps totals roughly right", () => {
    const s = demoSnapshot();
    const p = pseudonymize(s);
    expect(p.leads).toHaveLength(s.leads.length);
    for (const l of p.leads) { expect(new Date(l.arrivedAt).getUTCMinutes()).toBe(0); expect((l.contactMinutes ?? 0) % 5).toBe(0); }
    const exact = new Set(s.leads.map((l) => l.aum));
    const banded = new Set(p.leads.map((l) => l.aum));
    expect(banded.size).toBeLessThanOrEqual(13);
    expect(banded.size).toBeLessThan(exact.size);
    const a = sum(s.leads.map((l) => l.aum)), b = sum(p.leads.map((l) => l.aum));
    expect(Math.abs(a - b) / a).toBeLessThan(0.25);
  });
  it("carries no identifying fields at all", () => {
    const keys = new Set(Object.keys(pseudonymize(demoSnapshot()).leads[0]));
    for (const k of ["name", "mobile", "phone", "email", "pan", "clientId", "id"]) expect(keys.has(k)).toBe(false);
  });
  it("leaves funded and campaign facts untouched", () => {
    const s = demoSnapshot(); const p = pseudonymize(s);
    expect(p.leads.map((l) => l.funded)).toEqual(s.leads.map((l) => l.funded));
    expect(p.leads.map((l) => l.campaignId)).toEqual(s.leads.map((l) => l.campaignId));
  });
});

import { describe, expect, it } from "vitest";

import { can, rolesWith } from "@/lib/access/policy";

import { MANAGEMENT_INTEL_AREA, managementIntelEnabled, viewManagementKpis } from "./gate";
import type { KpiInput } from "./kpis";

const ON = { MANAGEMENT_INTEL_ENABLED: "1" };
const input: KpiInput = { leadsCreated: 10, leadsConverted: 2, stageDaysTotal: 6, stageMoves: 3, complaintsOpen: 1, complaintsOverdue: 0, promisesOverdue: 0 };

describe("MANAGEMENT_INTEL_ENABLED", () => {
  it("is off by default and on only for the exact value 1", () => {
    expect(managementIntelEnabled({})).toBe(false);
    expect(managementIntelEnabled({ MANAGEMENT_INTEL_ENABLED: "true" })).toBe(false);
    expect(managementIntelEnabled({ MANAGEMENT_INTEL_ENABLED: "0" })).toBe(false);
    expect(managementIntelEnabled(ON)).toBe(true);
  });
  it("gives nothing to anyone while the flag is off, even Admin", () => {
    expect(viewManagementKpis({ role: "ADMIN", env: {}, input })).toEqual({ ok: false, reason: "disabled" });
  });
});

describe("who may read management intelligence (access registry)", () => {
  it("lets Admin and Manager read it", () => {
    expect(rolesWith(MANAGEMENT_INTEL_AREA, "view").sort()).toEqual(["ADMIN", "MANAGER"]);
  });
  it("refuses an RM, even with the flag on", () => {
    expect(can("RM", MANAGEMENT_INTEL_AREA, "view")).toBe(false);
    expect(viewManagementKpis({ role: "RM", env: ON, input })).toEqual({ ok: false, reason: "forbidden" });
  });
  it("refuses every other role too: team manager, finance, marketing, dealer, partner", () => {
    for (const role of ["TEAM_MANAGER", "FINANCE", "MARKETING", "DEALER", "PARTNER", "AFFILIATE", "DISTRIBUTOR"]) {
      expect(viewManagementKpis({ role, env: ON, input }), role).toEqual({ ok: false, reason: "forbidden" });
    }
  });
  it("refuses a missing or unknown role", () => {
    expect(viewManagementKpis({ role: null, env: ON, input })).toEqual({ ok: false, reason: "forbidden" });
    expect(viewManagementKpis({ role: "SUPERUSER", env: ON, input })).toEqual({ ok: false, reason: "forbidden" });
  });
  it("gives Admin and Manager the aggregate headline", () => {
    for (const role of ["ADMIN", "MANAGER"]) {
      const r = viewManagementKpis({ role, env: ON, input });
      expect(r.ok, role).toBe(true);
      if (r.ok) expect(r.kpis.conversionRate).toBe(0.2);
    }
  });
  it("reports invalid input rather than a wrong number", () => {
    expect(viewManagementKpis({ role: "MANAGER", env: ON, input: { ...input, leadsConverted: 99 } })).toEqual({ ok: false, reason: "invalid_input", problems: ["converted_exceeds_created"] });
  });
});

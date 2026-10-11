import { describe, expect, it } from "vitest";

import { creativeAccess, creativeIntelEnabled, directorReportsEnabled } from "./flags";

describe("flags", () => {
  it("default off, and on only for the exact value 1", () => {
    expect(creativeIntelEnabled({})).toBe(false);
    expect(directorReportsEnabled({})).toBe(false);
    for (const v of ["true", "0", "yes", " 1", "1 "]) {
      expect(creativeIntelEnabled({ NEXT_PUBLIC_CREATIVE_INTEL: v })).toBe(false);
      expect(directorReportsEnabled({ DIRECTOR_REPORTS_ENABLED: v })).toBe(false);
    }
    expect(creativeIntelEnabled({ NEXT_PUBLIC_CREATIVE_INTEL: "1" })).toBe(true);
    expect(directorReportsEnabled({ DIRECTOR_REPORTS_ENABLED: "1" })).toBe(true);
  });
  it("access needs both the role and the flag", () => {
    const on = { NEXT_PUBLIC_CREATIVE_INTEL: "1", DIRECTOR_REPORTS_ENABLED: "1" };
    expect(creativeAccess("ADMIN", on)).toEqual({ creative: true, reports: true });
    expect(creativeAccess("MARKETING", on)).toEqual({ creative: true, reports: true });
    for (const role of ["MANAGER", "RM", "FINANCE", "DEALER"]) expect(creativeAccess(role, on)).toEqual({ creative: false, reports: false });
    expect(creativeAccess("ADMIN", {})).toEqual({ creative: false, reports: false });
    expect(creativeAccess("ADMIN", { DIRECTOR_REPORTS_ENABLED: "1" })).toEqual({ creative: false, reports: true });
  });
});

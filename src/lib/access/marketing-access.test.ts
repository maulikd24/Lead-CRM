import { describe, expect, it } from "vitest";

import { canAccessMarketing, isPseudonymousViewer } from "./marketing-access";

describe("canAccessMarketing", () => {
  it.each(["ADMIN", "MARKETING"])("allows %s", (role) => expect(canAccessMarketing(role)).toBe(true));
  it.each(["MANAGER", "RM", "FINANCE", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "admin", "Marketing", "", "MARKETING ", null, undefined])("refuses %s", (role) => expect(canAccessMarketing(role as string)).toBe(false));
});

describe("isPseudonymousViewer", () => {
  it("is MARKETING only", () => {
    expect(isPseudonymousViewer("MARKETING")).toBe(true);
    for (const role of ["ADMIN", "MANAGER", "RM", undefined]) expect(isPseudonymousViewer(role)).toBe(false);
  });
});

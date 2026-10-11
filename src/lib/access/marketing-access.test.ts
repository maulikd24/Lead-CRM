import { describe, expect, it } from "vitest";

import { canAccessMarketing } from "./marketing-access";

describe("canAccessMarketing", () => {
  it.each(["ADMIN", "MARKETING"])("allows %s", (role) => expect(canAccessMarketing(role)).toBe(true));
  it.each(["MANAGER", "RM", "FINANCE", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "admin", "Marketing", "", "MARKETING ", null, undefined])("refuses %s", (role) => expect(canAccessMarketing(role as string)).toBe(false));
});

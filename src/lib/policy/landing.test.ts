import { describe, expect, it } from "vitest";

import { ALL_ROLES } from "@/lib/access/policy";

import { landingFor, resolveWorkspaceHome } from "./workspace";

describe("where each role lands after signing in", () => {
  const expected: Record<string, string> = {
    ADMIN: "/dashboard",
    MANAGER: "/dashboard",
    RM: "/dashboard",
    DEALER: "/dealer-desk",
    TEAM_MANAGER: "/management-console",
    PARTNER: "/partner-home",
    AFFILIATE: "/partner-home",
    DISTRIBUTOR: "/partner-home",
    FINANCE: "/finance-console",
    MARKETING: "/marketing",
  };
  it.each(ALL_ROLES)("%s", (role) => expect(landingFor(role)).toBe(expected[role]));
  it("sends a denied marketing user home to the Marketing workspace", () => expect(resolveWorkspaceHome("MARKETING")).toBe("/marketing"));
});

import { describe, expect, it } from "vitest";

import type { Role } from "@/generated/prisma/client";

import { can, type ReferralAction } from "./permissions";

const ROLES: Role[] = ["ADMIN", "MANAGER", "RM", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "FINANCE"];
const allowed = (a: ReferralAction) => ROLES.filter((r) => can(r, a));

describe("referral permissions", () => {
  it("only Admin and Finance can see the programme", () => expect(allowed("view")).toEqual(["ADMIN", "FINANCE"]));
  it("only an Admin configures rules, referrers, codes and settings", () => {
    for (const a of ["manage_rules", "manage_referrers", "manage_settings"] as const) expect(allowed(a)).toEqual(["ADMIN"]);
  });
  it("Admin and Finance work the ledger and statements", () => {
    for (const a of ["prepare_statement", "approve_statement", "mark_paid", "reverse_entry", "clear_review", "refresh"] as const) expect(allowed(a)).toEqual(["ADMIN", "FINANCE"]);
  });
});

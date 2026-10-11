import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { wallHouseholdMembers } from "./privacy-wall";

const m = (id: string, assignedToId: string | null) => ({ id, client: { id: `c-${id}`, assignedToId } });
const members = [m("1", "rm-a"), m("2", "rm-b"), m("3", null)];

describe("wallHouseholdMembers: the household privacy wall for every role, flag or no flag", () => {
  it("admin sees every member (unrestricted scope)", () => {
    expect(wallHouseholdMembers("ADMIN", null, members).map((x) => x.id)).toEqual(["1", "2", "3"]);
  });
  it("manager sees only their team's members, plus unassigned leads they assign", () => {
    expect(wallHouseholdMembers("MANAGER", ["rm-a"], members).map((x) => x.id)).toEqual(["1", "3"]);
  });
  it("an RM sees only their own customers, never another RM's or an unassigned one", () => {
    expect(wallHouseholdMembers("RM", ["rm-a"], members).map((x) => x.id)).toEqual(["1"]);
  });
  it("every other role sees nobody (their scope is empty)", () => {
    for (const role of ["MARKETING", "FINANCE", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "DEALER", "TEAM_MANAGER"]) {
      expect(wallHouseholdMembers(role, [], members), role).toEqual([]);
    }
  });
});

describe("the household detail page", () => {
  const page = readFileSync(join(process.cwd(), "src/app/(dashboard)/households/[id]/page.tsx"), "utf8");
  it("applies the wall unconditionally: not behind HOUSEHOLD_INTELLIGENCE_ENABLED", () => {
    expect(page).toContain("wallHouseholdMembers(");
    expect(page).not.toMatch(/householdIntelligenceEnabled\(\)\s*&&[^;]*\n?[^;]*household\.members\s*=/);
    // the filter line itself must not sit under an `if (walled)` that depends on the flag
    expect(page).not.toMatch(/if \(walled\) household\.members/);
  });
});

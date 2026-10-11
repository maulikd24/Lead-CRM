import { describe, expect, it } from "vitest";
import { canSeeDecision, drawerOffered } from "./access";

const own = { assignedToId: "rm1" };
const other = { assignedToId: "rm2" };

describe("who may see a decision (default deny)", () => {
  it("admin sees any customer", () => expect(canSeeDecision({ id: "a", role: "ADMIN" }, null, other, {})).toBe(true));
  it("a manager sees their team only", () => {
    expect(canSeeDecision({ id: "m", role: "MANAGER" }, ["rm1"], own, {})).toBe(true);
    expect(canSeeDecision({ id: "m", role: "MANAGER" }, ["rm1"], other, {})).toBe(false);
  });
  it("an RM sees only their own customers, and only with the RM flag on", () => {
    expect(canSeeDecision({ id: "rm1", role: "RM" }, ["rm1"], own, {})).toBe(false);
    expect(canSeeDecision({ id: "rm1", role: "RM" }, ["rm1"], own, { NBA_RM_VISIBLE: "1" })).toBe(true);
    expect(canSeeDecision({ id: "rm1", role: "RM" }, ["rm1"], other, { NBA_RM_VISIBLE: "1" })).toBe(false);
    expect(canSeeDecision({ id: "rm1", role: "RM" }, ["rm1"], { assignedToId: null }, { NBA_RM_VISIBLE: "1" })).toBe(false);
  });
  it("nobody else, marketing included, even with every flag on", () => {
    for (const role of ["MARKETING", "FINANCE", "PARTNER", "DEALER", "TEAM_MANAGER", "AFFILIATE", "DISTRIBUTOR", "UNKNOWN"]) {
      expect(canSeeDecision({ id: "x", role }, null, own, { NBA_RM_VISIBLE: "1", NEXT_PUBLIC_DECISION_DRAWER: "1" }), role).toBe(false);
    }
  });
  it("the drawer is offered only with the screen flag, and to an RM only with the RM flag", () => {
    expect(drawerOffered("ADMIN", {})).toBe(false);
    expect(drawerOffered("ADMIN", { NEXT_PUBLIC_DECISION_DRAWER: "1" })).toBe(true);
    expect(drawerOffered("RM", { NEXT_PUBLIC_DECISION_DRAWER: "1" })).toBe(false);
    expect(drawerOffered("RM", { NEXT_PUBLIC_DECISION_DRAWER: "1", NBA_RM_VISIBLE: "1" })).toBe(true);
    expect(drawerOffered("MARKETING", { NEXT_PUBLIC_DECISION_DRAWER: "1", NBA_RM_VISIBLE: "1" })).toBe(false);
  });
});

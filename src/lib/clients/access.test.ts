import { describe, expect, it } from "vitest";

import { canViewClient } from "./access";

describe("canViewClient", () => {
  it("lets an unrestricted viewer (null) see everyone", () => expect(canViewClient("ADMIN", null, { assignedToId: null })).toBe(true));
  it("lets an RM see only their own clients", () => {
    expect(canViewClient("RM", ["u1"], { assignedToId: "u1" })).toBe(true);
    expect(canViewClient("RM", ["u1"], { assignedToId: "u2" })).toBe(false);
    expect(canViewClient("RM", ["u1"], { assignedToId: null })).toBe(false);
  });
  it("lets a manager see themselves, their reports and unassigned leads", () => {
    expect(canViewClient("MANAGER", ["m", "r1"], { assignedToId: "r1" })).toBe(true);
    expect(canViewClient("MANAGER", ["m", "r1"], { assignedToId: "other" })).toBe(false);
    expect(canViewClient("MANAGER", ["m", "r1"], { assignedToId: null })).toBe(true);
  });
});

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

import { canOpen360 } from "./access";

describe("canOpen360", () => {
  const base = { assignedToId: "u1", isDeleted: false, mergedIntoId: null };
  it("follows the detail page rule for a live customer", () => {
    expect(canOpen360("RM", ["u1"], base)).toBe(true);
    expect(canOpen360("RM", ["u2"], base)).toBe(false);
  });
  it("a merged customer is not found for anyone, admins included", () => {
    expect(canOpen360("ADMIN", null, { ...base, mergedIntoId: "other" })).toBe(false);
  });
  it("an archived customer is visible to admins only", () => {
    expect(canOpen360("ADMIN", null, { ...base, isDeleted: true })).toBe(true);
    expect(canOpen360("MANAGER", ["u1"], { ...base, isDeleted: true })).toBe(false);
    expect(canOpen360("RM", ["u1"], { ...base, isDeleted: true })).toBe(false);
  });
});

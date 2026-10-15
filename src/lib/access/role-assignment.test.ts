import { describe, expect, it, vi } from "vitest";

import { assignRole, type RoleAssignDeps } from "./role-assignment";

function deps(over: Partial<RoleAssignDeps> = {}): RoleAssignDeps & { audit: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } {
  return {
    getUser: vi.fn(async (id: string) => ({ id, name: "Mia", role: "RM" as const, isActive: true })),
    countAssignedCustomers: vi.fn(async () => 0),
    update: vi.fn(async () => undefined),
    audit: vi.fn(async () => undefined),
    ...over,
  } as never;
}
const admin = { id: "a1", role: "ADMIN" as const };

describe("assigning a role", () => {
  it("lets an admin assign MARKETING and writes an audit entry with the old and new role", async () => {
    const d = deps();
    await assignRole(d, { actor: admin, userId: "u1", role: "MARKETING" });
    expect(d.update).toHaveBeenCalledWith("u1", "MARKETING");
    expect(d.audit).toHaveBeenCalledWith({ userId: "a1", entity: "User", entityId: "u1", action: "role_changed", oldValue: { role: "RM" }, newValue: { role: "MARKETING" } });
  });
  it.each(["MANAGER", "RM", "FINANCE", "MARKETING", "DEALER", "PARTNER", "TEAM_MANAGER"] as const)("refuses %s as the actor, and changes and audits nothing", async (role) => {
    const d = deps();
    await expect(assignRole(d, { actor: { id: "x", role }, userId: "u1", role: "MARKETING" })).rejects.toThrow(/admin/i);
    expect(d.update).not.toHaveBeenCalled();
    expect(d.audit).not.toHaveBeenCalled();
  });
  it("refuses a role that does not exist", async () => {
    const d = deps();
    await expect(assignRole(d, { actor: admin, userId: "u1", role: "SUPERHERO" as never })).rejects.toThrow(/role/i);
    expect(d.update).not.toHaveBeenCalled();
  });
  it("refuses an unknown user", async () => {
    const d = deps({ getUser: vi.fn(async () => null) });
    await expect(assignRole(d, { actor: admin, userId: "nope", role: "MARKETING" })).rejects.toThrow(/not found/i);
  });
  it("does nothing, and writes no audit entry, when the role is unchanged", async () => {
    const d = deps({ getUser: vi.fn(async (id: string) => ({ id, name: "Mia", role: "MARKETING" as const, isActive: true })) });
    await assignRole(d, { actor: admin, userId: "u1", role: "MARKETING" });
    expect(d.update).not.toHaveBeenCalled();
    expect(d.audit).not.toHaveBeenCalled();
  });
  it("will not make someone MARKETING while they still own customers: reassign first", async () => {
    const d = deps({ countAssignedCustomers: vi.fn(async () => 12) });
    await expect(assignRole(d, { actor: admin, userId: "u1", role: "MARKETING" })).rejects.toThrow(/12 customers/);
    expect(d.update).not.toHaveBeenCalled();
  });
  it("does not apply the customer check to other roles", async () => {
    const d = deps({ countAssignedCustomers: vi.fn(async () => 12) });
    await assignRole(d, { actor: admin, userId: "u1", role: "MANAGER" });
    expect(d.update).toHaveBeenCalledWith("u1", "MANAGER");
  });
});

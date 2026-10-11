import type { Role } from "@/generated/prisma/client";

import { ALL_ROLES, can } from "./policy";

export type RoleAssignDeps = {
  getUser(id: string): Promise<{ id: string; name: string; role: Role; isActive: boolean } | null>;
  /** Customers (not deleted) whose owner is this user. */
  countAssignedCustomers(userId: string): Promise<number>;
  update(userId: string, role: Role): Promise<void>;
  audit(entry: { userId: string; entity: "User"; entityId: string; action: string; oldValue: { role: Role }; newValue: { role: Role } }): Promise<void>;
};

/**
 * Changes a person's role. Admin only (the registry's settings-users area), the role must exist, every real change is
 * audited with the old and the new value, and nobody becomes MARKETING while they still own customers (marketing has
 * no customer access, so those customers would be stranded). Throws an Error with a sentence the Admin can act on.
 */
export async function assignRole(deps: RoleAssignDeps, input: { actor: { id: string; role: Role }; userId: string; role: Role }): Promise<void> {
  if (!can(input.actor.role, "settings-users", "manage")) throw new Error("Only an Admin can change roles.");
  if (!ALL_ROLES.includes(input.role)) throw new Error("That role does not exist.");
  const user = await deps.getUser(input.userId);
  if (!user) throw new Error("User not found.");
  if (user.role === input.role) return;
  if (input.role === "MARKETING") {
    const owned = await deps.countAssignedCustomers(user.id);
    if (owned > 0) throw new Error(`${user.name} still owns ${owned} customers. Reassign them before making this person a marketing user.`);
  }
  await deps.update(user.id, input.role);
  await deps.audit({ userId: input.actor.id, entity: "User", entityId: user.id, action: "role_changed", oldValue: { role: user.role }, newValue: { role: input.role } });
}

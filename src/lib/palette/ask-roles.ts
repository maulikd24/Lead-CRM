import type { Role } from "@/generated/prisma/client";

/** Roles allowed to "Ask the system". Shared by the server action and the Cmd+K palette so they cannot drift. */
export const ASK_ROLES: readonly Role[] = ["ADMIN", "MANAGER"];

export function canAsk(role: Role): boolean {
  return ASK_ROLES.includes(role);
}

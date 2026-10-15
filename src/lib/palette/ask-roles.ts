import type { Role } from "@/generated/prisma/client";
import { can, rolesWith } from "@/lib/access/policy";

/** Roles allowed to "Ask the system". Derived from the central registry (area "intelligence", action "manage") so the server action and the Cmd+K palette cannot drift from it. */
export const ASK_ROLES: readonly Role[] = rolesWith("intelligence", "manage");

export function canAsk(role: Role): boolean {
  return can(role, "intelligence", "manage");
}

/** The Co-pilot chat Ask: managers and admins (management scope) and RMs (their own customers only). Registered as surface "ask.copilot-chat". */
export function canAskCopilot(role: Role): boolean {
  return can(role, "copilot", "manage");
}

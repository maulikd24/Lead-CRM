// Who may see a decision. Pure. Default deny.
//   ADMIN    any customer, in shadow review.
//   MANAGER  customers of their team (and unassigned leads), in shadow review.
//   RM       only their OWN customers, and only when NBA_RM_VISIBLE is on.
//   everyone else (MARKETING included): never. Decisions can name a customer's complaint, consent and product stance.
import { canViewClient } from "@/lib/clients/access";
import { drawerFlagOn, rmVisible } from "./enabled";

type Env = Record<string, string | undefined>;

export type Viewer = { id: string; role: string };

export function canSeeDecision(viewer: Viewer, visibleUserIds: string[] | null, client: { assignedToId: string | null }, env: Env = process.env): boolean {
  if (viewer.role === "ADMIN") return true;
  if (viewer.role === "MANAGER") return canViewClient(viewer.role, visibleUserIds, client);
  if (viewer.role === "RM") return rmVisible(env) && client.assignedToId === viewer.id;
  return false;
}

/** Whether the drawer is offered at all to this role (the screen flag is build-time; the RM flag is run-time). */
export function drawerOffered(role: string, env: Env = process.env): boolean {
  if (!drawerFlagOn(env)) return false;
  if (role === "ADMIN" || role === "MANAGER") return true;
  if (role === "RM") return rmVisible(env);
  return false;
}

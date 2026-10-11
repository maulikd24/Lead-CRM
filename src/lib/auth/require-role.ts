import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/config";
import { resolveWorkspaceHome } from "@/lib/policy/workspace";
import type { Role } from "@/generated/prisma/client";
import { can, type Action, type Area } from "@/lib/access/policy";

/** Signed in, without the forced-password-change gate. Only for the change-password flow itself. */
export async function requireSession() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return session;
}

/** Redirects to /login if unauthenticated, or to a role-appropriate landing page if not in allowedRoles. */
export async function requireRole(allowedRoles: Role[]) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.mustChangePassword) redirect("/change-password");
  if (!allowedRoles.includes(session.user.role)) {
    redirect(resolveWorkspaceHome(session.user.role));
  }
  return session;
}

/** Every page and server action goes through this (or requireRole): a user who must change their password is
 * sent to /change-password and can do nothing else until they have. */
export async function requireUser() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.mustChangePassword) redirect("/change-password");
  return session;
}

/**
 * The guard every page and server action uses: signed in, past the forced-password-change gate, and the central
 * registry (src/lib/access/policy.ts) grants this role the action on this area. Anyone else is sent to their own home.
 * Same return value as requireUser/requireRole, so call sites do not change shape.
 */
export async function requireAccess(area: Area, action: Action = "view") {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.mustChangePassword) redirect("/change-password");
  if (!can(session.user.role, area, action)) redirect(resolveWorkspaceHome(session.user.role));
  return session;
}

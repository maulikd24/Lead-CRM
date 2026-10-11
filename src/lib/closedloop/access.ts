import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/config";
import { canAccessMarketing } from "@/lib/access/marketing-access";
import type { Role } from "@/generated/prisma/client";
import { resolveWorkspaceHome } from "@/lib/policy/workspace";

/** Every closed-loop page and action starts here: signed in, no pending password change, and an Admin or Marketing user. Anyone else goes to their own home. */
export async function requireClosedLoopAccess() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.mustChangePassword) redirect("/change-password");
  if (!canAccessMarketing(session.user.role)) redirect(resolveWorkspaceHome(session.user.role as Role));
  return session;
}

/** Configuration (credentials, regions, values, bands, turning the kill switch off): Admin only. Marketing can view, retry and stop everything, not reconfigure. */
export async function requireClosedLoopAdmin() {
  const session = await requireClosedLoopAccess();
  if (session.user.role !== "ADMIN") redirect(resolveWorkspaceHome(session.user.role as Role));
  return session;
}

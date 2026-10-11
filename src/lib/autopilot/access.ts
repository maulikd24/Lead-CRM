import { redirect } from "next/navigation";

import { canAccessMarketing } from "@/lib/access/marketing-access";
import { auth } from "@/lib/auth/config";
import { resolveWorkspaceHome } from "@/lib/policy/workspace";
import type { Role } from "@/generated/prisma/client";

/**
 * The one gate for every Autopilot page, action, API route and job output. Only ADMIN and MARKETING pass.
 * A MARKETING user is "pseudonymous": loaders blur anything that could identify a customer for them.
 */
export type Viewer = { id: string; role: string; pseudonymous: boolean };

export async function requireAutopilotViewer(): Promise<Viewer> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.mustChangePassword) redirect("/change-password");
  if (!canAccessMarketing(session.user.role)) redirect(resolveWorkspaceHome(session.user.role as Role));
  return { id: session.user.id, role: session.user.role, pseudonymous: session.user.role !== "ADMIN" };
}

/** For route handlers: a status instead of a redirect. */
export async function autopilotViewerOrNull(): Promise<Viewer | null> {
  const session = await auth();
  if (!session?.user || session.user.mustChangePassword || !canAccessMarketing(session.user.role)) return null;
  return { id: session.user.id, role: session.user.role, pseudonymous: session.user.role !== "ADMIN" };
}

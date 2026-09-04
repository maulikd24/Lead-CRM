import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/config";
import type { Role } from "@/generated/prisma/client";

/** Redirects to /login if unauthenticated, or to a role-appropriate landing page if not in allowedRoles. */
export async function requireRole(allowedRoles: Role[]) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!allowedRoles.includes(session.user.role)) {
    redirect(session.user.role === "DEALER" ? "/dealer-desk" : "/clients");
  }
  return session;
}

export async function requireUser() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return session;
}

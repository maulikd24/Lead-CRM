import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/config";
import { can, type Action, type Area } from "@/lib/access/policy";

/**
 * The guard for API routes that answer a signed-in person (the pages use requireAccess, which redirects; a route must
 * answer 401 or 403 instead). 401 when there is no session or the forced password change is pending, 403 (or 404 when the route should not reveal itself) when the
 * registry refuses the role for this area and action. A caller that passes gets the session.
 */
export async function apiGuard(area: Area, action: Action = "view", denyAs: 403 | 404 = 403) {
  const session = await auth();
  if (!session?.user || session.user.mustChangePassword) return { ok: false as const, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!can(session.user.role, area, action)) {
    return { ok: false as const, response: denyAs === 404 ? new NextResponse("Not found", { status: 404 }) : NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true as const, session };
}

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/config";
import { logUserEvent } from "@/lib/activity/log-user-event";

// A route handler rather than a server action so page-view pings never queue behind real actions.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let path: unknown;
  try {
    ({ path } = await request.json());
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  // Pathname only: query strings can carry client names/filters, so they are never stored.
  if (typeof path !== "string" || !path.startsWith("/") || path.length > 300) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  await logUserEvent({
    userId: session.user.id,
    userEmail: session.user.email,
    userRole: session.user.role,
    type: "PAGE_VIEW",
    path: path.split("?")[0],
    summary: `Viewed ${path.split("?")[0]}`,
  });
  return NextResponse.json({ ok: true });
}

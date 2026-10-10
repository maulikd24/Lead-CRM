import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/config";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { getLiveCounts } from "@/lib/dashboard/live-counts";
import { rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { motionEnabled } from "@/components/motion/tokens";

export const dynamic = "force-dynamic";

const ALLOWED = ["ADMIN", "MANAGER", "RM"];

/** Polled by the animated manager home. Counts only, scoped like the dashboard. Off unless NEXT_PUBLIC_MOTION=1. */
export async function GET() {
  if (!motionEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.mustChangePassword || !ALLOWED.includes(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const limit = await rateLimit("live-counts", session.user.id, { limit: 60, windowSeconds: 60 });
  if (!limit.allowed) return tooManyRequests(limit);
  const visible = await getVisibleUserIds(session.user.id, session.user.role);
  const counts = await getLiveCounts(visible, session.user.role);
  return NextResponse.json(counts, { headers: { "Cache-Control": "no-store" } });
}

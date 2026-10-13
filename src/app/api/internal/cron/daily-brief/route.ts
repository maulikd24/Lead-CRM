import { NextResponse } from "next/server";

import { safeEqual } from "@/lib/security/webhook-auth";
import { runDailyBrief } from "@/lib/daily-brief/job";

// Manual trigger for the RM daily brief. The 09:00 IST send runs from the cron tick (see src/app/api/internal/cron/tick),
// not from here. This route does not enforce the send window, so use dry=1 to check a run.
//
//   curl -X POST -H "x-cron-secret: $CRON_SECRET" \
//     "https://<app>/api/internal/cron/daily-brief?dry=1&rm=<rm id or email>"
//   dry=1  -> builds and counts, sends nothing, writes nothing
//   rm=    -> only that RM (id or email)
//
// Still needs DAILY_BRIEF_ENABLED=1. Non-dry runs stay once-per-RM-per-day through the DailyBriefLog.
export async function POST(request: Request) {
  // Timing-safe, and fails closed when CRON_SECRET is unset.
  if (!safeEqual(request.headers.get("x-cron-secret"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const result = await runDailyBrief({ dry: url.searchParams.get("dry") === "1", rm: url.searchParams.get("rm") });
  return NextResponse.json({ ok: !("error" in result), ...result });
}

import { NextResponse } from "next/server";

import { safeEqual } from "@/lib/security/webhook-auth";
import { runDailyBrief } from "@/lib/daily-brief/job";

// Manual check for the RM daily brief. Dry run only. The 09:00 IST send runs from the cron tick (see
// src/app/api/internal/cron/tick), and only the scheduled job can send. A non-dry call here returns 409.
//
//   curl -X POST -H "x-cron-secret: $CRON_SECRET" \
//     "https://<app>/api/internal/cron/daily-brief?dry=1&rm=<rm id or email>"
//   dry=1  -> builds and counts, sends nothing, writes nothing
//   rm=    -> only that RM (id or email)
//
// Still needs DAILY_BRIEF_ENABLED=1. The response also lists RMs with a pending log row for today (see the job).
export async function POST(request: Request) {
  // Timing-safe, and fails closed when CRON_SECRET is unset.
  if (!safeEqual(request.headers.get("x-cron-secret"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  if (url.searchParams.get("dry") !== "1") {
    return NextResponse.json({ ok: false, reason: "sends happen only from the scheduled job" }, { status: 409 });
  }
  const result = await runDailyBrief({ dry: true, rm: url.searchParams.get("rm") });
  return NextResponse.json({ ok: !("error" in result), ...result });
}

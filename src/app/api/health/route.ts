import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { CRON_HEARTBEAT, HEARTBEAT_STALE_MS, getHeartbeatAgeMs } from "@/lib/system/heartbeat";

// Public on purpose — an uptime monitor (UptimeRobot, Better Stack…) has to reach it without a login. It only says
// whether the app can reach its database and whether the background scheduler is still ticking; no data, no names.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return NextResponse.json({ ok: false, database: "down" }, { status: 503 });
  }
  const ageMs = await getHeartbeatAgeMs(CRON_HEARTBEAT).catch(() => null);
  const schedulerOk = ageMs !== null && ageMs <= HEARTBEAT_STALE_MS;
  return NextResponse.json(
    { ok: schedulerOk, database: "up", scheduler: schedulerOk ? "ticking" : ageMs === null ? "never-ran" : "stale", lastTickMinutesAgo: ageMs === null ? null : Math.round(ageMs / 60000) },
    { status: schedulerOk ? 200 : 503 },
  );
}

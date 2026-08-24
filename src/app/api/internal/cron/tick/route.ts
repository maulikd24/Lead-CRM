import { NextResponse } from "next/server";

import { checkOverdueTasks } from "@/lib/sla/check-overdue-tasks";
import { processDueJourneySteps } from "@/lib/journeys/poller";

export async function POST(request: Request) {
  const secret = request.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const slaResult = await checkOverdueTasks();
  const journeyResult = await processDueJourneySteps();

  return NextResponse.json({ ok: true, sla: slaResult, journeys: journeyResult });
}

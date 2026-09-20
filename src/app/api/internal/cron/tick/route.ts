import { NextResponse } from "next/server";

import { checkOverdueTasks } from "@/lib/sla/check-overdue-tasks";
import { checkStageSla } from "@/lib/sla/check-stage-sla";
import { checkFundingSla } from "@/lib/sla/check-funding-sla";
import { processDueJourneySteps } from "@/lib/journeys/poller";
import { checkDisengagement } from "@/lib/copilot/check-disengagement";
import { sendDailyReportEmail } from "@/lib/notifications/send-daily-report-email";
import { sendWeeklyManagementReport, sendMonthlyManagementReport } from "@/lib/notifications/send-management-report-email";
import { seedDistributionOsDemoData } from "@/lib/notifications/seed-distribution-os-demo";
import { seedBaselineStages } from "@/lib/stage-engine/seed-baseline-stages";
import { seedSystemActor } from "@/lib/system/system-actor";

// Each job is isolated — a throw in one must not prevent the others from running this tick.
async function runJob<T>(name: string, job: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await job();
  } catch (error) {
    console.error(`Cron job "${name}" failed`, error);
    return { error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export async function POST(request: Request) {
  const secret = request.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const taskSlaResult = await runJob("checkOverdueTasks", checkOverdueTasks);
  const stageSlaResult = await runJob("checkStageSla", checkStageSla);
  const fundingSlaResult = await runJob("checkFundingSla", checkFundingSla);
  const journeyResult = await runJob("processDueJourneySteps", processDueJourneySteps);
  const disengagementResult = await runJob("checkDisengagement", checkDisengagement);
  const dailyReportResult = await runJob("sendDailyReportEmail", sendDailyReportEmail);
  const weeklyReportResult = await runJob("sendWeeklyManagementReport", sendWeeklyManagementReport);
  const monthlyReportResult = await runJob("sendMonthlyManagementReport", sendMonthlyManagementReport);
  const seedDistributionOsResult = await runJob("seedDistributionOsDemoData", seedDistributionOsDemoData);
  const seedBaselineStagesResult = await runJob("seedBaselineStages", seedBaselineStages);
  const seedSystemActorResult = await runJob("seedSystemActor", seedSystemActor);

  return NextResponse.json({
    ok: true,
    taskSla: taskSlaResult,
    stageSla: stageSlaResult,
    fundingSla: fundingSlaResult,
    journeys: journeyResult,
    disengagement: disengagementResult,
    dailyReport: dailyReportResult,
    weeklyReport: weeklyReportResult,
    monthlyReport: monthlyReportResult,
    seedDistributionOs: seedDistributionOsResult,
    seedBaselineStages: seedBaselineStagesResult,
    seedSystemActor: seedSystemActorResult,
  });
}

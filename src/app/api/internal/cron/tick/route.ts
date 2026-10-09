import { NextResponse, after } from "next/server";

import { safeEqual } from "@/lib/security/webhook-auth";
import { pruneSecurityTables } from "@/lib/security/webhook-dedupe";

import { checkOverdueTasks } from "@/lib/sla/check-overdue-tasks";
import { checkStageSla } from "@/lib/sla/check-stage-sla";
import { checkFundingSla } from "@/lib/sla/check-funding-sla";
import { processDueJourneySteps } from "@/lib/journeys/poller";
import { checkDisengagement } from "@/lib/copilot/check-disengagement";
import { sendDailyReportEmail } from "@/lib/notifications/send-daily-report-email";
import { sendWeeklyManagementReport, sendMonthlyManagementReport } from "@/lib/notifications/send-management-report-email";
import { seedBaselineStages } from "@/lib/stage-engine/seed-baseline-stages";
import { backfillCompletedClientsToFinalStage } from "@/lib/stage-engine/backfill-completed-clients";
import { seedSystemActor } from "@/lib/system/system-actor";
import { checkWhatsAppAccountHealth } from "@/lib/whatsapp/health";
import { checkStaleVoiceAnalysis } from "@/lib/ai/check-stale-voice-analysis";
import { sweepWhatsAppConversationReviews } from "@/lib/ai/sweep-whatsapp-reviews";
import { runDailyAuditChainCheck } from "@/lib/audit/verify-chain";
import { checkKycDropOffs } from "@/lib/kyc/drop-off";
import { syncFreshdeskHistory } from "@/lib/support/freshdesk-sync";
import { retryFailedLeads } from "@/lib/leads/retry";
import { refreshStaleIntelligence } from "@/lib/intelligence/refresh";
import { extractConversationInsights } from "@/lib/intelligence/extract";
import { CRON_HEARTBEAT, CRON_TICK_LOCK, claimLease, recordHeartbeat, releaseLease } from "@/lib/system/heartbeat";

// Each job is isolated — a throw in one must not prevent the others from running this tick.
async function runJob<T>(name: string, job: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await job();
  } catch (error) {
    console.error(`Cron job "${name}" failed`, error);
    return { error: error instanceof Error ? error.message : "Unknown error" };
  }
}

// Fluid compute max on Hobby. The work runs in after() up to this limit, and the tick lock's lease matches it.
export const maxDuration = 300;
const TICK_LEASE_MS = maxDuration * 1000;

/** Called every 5 minutes by the external scheduler (cron-job.org) and, as a backup, GitHub Actions.
 * Responds immediately and does the work in after(): external schedulers time out after ~30s, and the jobs can take
 * longer. A lease lock makes overlapping calls (two schedulers, a retry) skip instead of double-running jobs.
 * Add ?wait=1 to run synchronously and get every job's result back (manual debugging). */
export async function POST(request: Request) {
  // Timing-safe, and fails closed if CRON_SECRET is unset.
  if (!safeEqual(request.headers.get("x-cron-secret"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // First thing: proves the scheduler fired (read by /api/health and the Go-Live page), even if a tick is skipped.
  await runJob("heartbeat", () => recordHeartbeat(CRON_HEARTBEAT));

  if (!(await claimLease(CRON_TICK_LOCK, TICK_LEASE_MS))) {
    return NextResponse.json({ ok: true, skipped: "a tick is already running" });
  }

  const run = async () => {
    const startedAt = Date.now();
    try {
      const results = await runTick();
      console.log(JSON.stringify({ event: "cron_tick_completed", ms: Date.now() - startedAt, results }));
      return results;
    } finally {
      await releaseLease(CRON_TICK_LOCK).catch((error) => console.error("Failed to release the tick lock", error));
    }
  };

  if (new URL(request.url).searchParams.get("wait") === "1") {
    return NextResponse.json({ ok: true, ...(await run()) });
  }
  after(run);
  return NextResponse.json({ ok: true, accepted: true }, { status: 202 });
}

async function runTick() {
  const taskSlaResult = await runJob("checkOverdueTasks", checkOverdueTasks);
  const stageSlaResult = await runJob("checkStageSla", checkStageSla);
  const fundingSlaResult = await runJob("checkFundingSla", checkFundingSla);
  const journeyResult = await runJob("processDueJourneySteps", processDueJourneySteps);
  const disengagementResult = await runJob("checkDisengagement", checkDisengagement);
  const whatsappHealthResult = await runJob("checkWhatsAppAccountHealth", checkWhatsAppAccountHealth);
  const dailyReportResult = await runJob("sendDailyReportEmail", sendDailyReportEmail);
  const weeklyReportResult = await runJob("sendWeeklyManagementReport", sendWeeklyManagementReport);
  const monthlyReportResult = await runJob("sendMonthlyManagementReport", sendMonthlyManagementReport);
  const seedBaselineStagesResult = await runJob("seedBaselineStages", seedBaselineStages);
  const seedSystemActorResult = await runJob("seedSystemActor", seedSystemActor);
  // Must run after seedBaselineStages — depends on "Onboarding Completed" already existing.
  const backfillCompletedResult = await runJob("backfillCompletedClientsToFinalStage", backfillCompletedClientsToFinalStage);
  const staleVoiceAnalysisResult = await runJob("checkStaleVoiceAnalysis", checkStaleVoiceAnalysis);
  const whatsappReviewSweepResult = await runJob("sweepWhatsAppConversationReviews", sweepWhatsAppConversationReviews);
  const kycDropOffResult = await runJob("checkKycDropOffs", () => checkKycDropOffs());
  const freshdeskHistoryResult = await runJob("syncFreshdeskHistory", () => syncFreshdeskHistory());
  // Read conversations first so this tick's refresh already reflects what customers just said.
  const insightsResult = await runJob("extractConversationInsights", extractConversationInsights);
  const intelligenceResult = await runJob("refreshStaleIntelligence", () => refreshStaleIntelligence());
  const leadRetryResult = await runJob("retryFailedLeads", () => retryFailedLeads());
  const pruneSecurityResult = await runJob("pruneSecurityTables", () => pruneSecurityTables());
  const auditChainResult = await runJob("runDailyAuditChainCheck", () => runDailyAuditChainCheck());

  return {
    taskSla: taskSlaResult,
    stageSla: stageSlaResult,
    fundingSla: fundingSlaResult,
    journeys: journeyResult,
    disengagement: disengagementResult,
    whatsappHealth: whatsappHealthResult,
    dailyReport: dailyReportResult,
    weeklyReport: weeklyReportResult,
    monthlyReport: monthlyReportResult,
    seedBaselineStages: seedBaselineStagesResult,
    seedSystemActor: seedSystemActorResult,
    backfillCompletedClientsToFinalStage: backfillCompletedResult,
    checkStaleVoiceAnalysis: staleVoiceAnalysisResult,
    sweepWhatsAppConversationReviews: whatsappReviewSweepResult,
    kycDropOffs: kycDropOffResult,
    freshdeskHistory: freshdeskHistoryResult,
    conversationInsights: insightsResult,
    customerIntelligence: intelligenceResult,
    leadRetry: leadRetryResult,
    pruneSecurityTables: pruneSecurityResult,
    auditChain: auditChainResult,
  };
}

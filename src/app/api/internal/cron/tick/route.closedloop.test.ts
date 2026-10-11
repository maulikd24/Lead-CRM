import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) }, after: vi.fn() }));
vi.mock("@/lib/security/webhook-auth", () => ({ safeEqual: () => true }));
vi.mock("@/lib/security/webhook-dedupe", () => ({ pruneSecurityTables: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/sla/check-overdue-tasks", () => ({ checkOverdueTasks: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/sla/check-stage-sla", () => ({ checkStageSla: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/sla/check-funding-sla", () => ({ checkFundingSla: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/journeys/poller", () => ({ processDueJourneySteps: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/copilot/check-disengagement", () => ({ checkDisengagement: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/notifications/send-daily-report-email", () => ({ sendDailyReportEmail: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/notifications/send-management-report-email", () => ({ sendWeeklyManagementReport: vi.fn().mockResolvedValue({ ok: true }), sendMonthlyManagementReport: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/stage-engine/seed-baseline-stages", () => ({ seedBaselineStages: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/stage-engine/backfill-completed-clients", () => ({ backfillCompletedClientsToFinalStage: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/system/system-actor", () => ({ seedSystemActor: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/whatsapp/health", () => ({ checkWhatsAppAccountHealth: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/ai/check-stale-voice-analysis", () => ({ checkStaleVoiceAnalysis: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/ai/sweep-whatsapp-reviews", () => ({ sweepWhatsAppConversationReviews: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/audit/verify-chain", () => ({ runDailyAuditChainCheck: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/kyc/drop-off", () => ({ checkKycDropOffs: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/leads/retry", () => ({ retryFailedLeads: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/intelligence/refresh", () => ({ refreshStaleIntelligence: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/integrations/clevertap/push-batch", () => ({ pushStaleSignals: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/agents/nudger-batch", () => ({ runNudgerBatch: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/agents/wiring", () => ({ runAgentSweeper: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/intelligence/extract", () => ({ extractConversationInsights: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/system/heartbeat", () => ({ CRON_HEARTBEAT: "h", CRON_TICK_LOCK: "l", claimLease: vi.fn().mockResolvedValue(true), recordHeartbeat: vi.fn().mockResolvedValue({ ok: true }), releaseLease: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/referrals/job", () => ({ runReferralJob: vi.fn().mockResolvedValue({ ok: true }) }));
const closedLoop = vi.hoisted(() => ({ runClosedLoopJob: vi.fn() }));
vi.mock("@/lib/closedloop/job", () => closedLoop);
const meta = vi.hoisted(() => ({ syncMetaAds: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/marketing/sync-meta", () => meta);
const backoffice = vi.hoisted(() => ({ runBackOfficeImport: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/backoffice-import/job", () => backoffice);

import { POST } from "./route";

const tick = async () => ((await POST(new Request("http://x/api/internal/cron/tick?wait=1", { method: "POST" }))) as unknown as { body: Record<string, unknown> }).body;

describe("cron tick and the closed-loop conversions job", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs the job once per tick and reports its counts under one key", async () => {
    closedLoop.runClosedLoopJob.mockResolvedValue({ skipped: "flag off" });
    const body = await tick();
    expect(closedLoop.runClosedLoopJob).toHaveBeenCalledTimes(1);
    expect(body.closedLoop).toEqual({ skipped: "flag off" });
  });

  it("a crash is reported as an error and never stops the tick or the jobs around it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    closedLoop.runClosedLoopJob.mockRejectedValue(new Error("boom"));
    const body = await tick();
    expect(body.closedLoop).toEqual({ error: "boom" });
    expect(body.referral).toBeDefined();
    expect(body.auditChain).toBeDefined();
  });
});

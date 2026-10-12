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
const referral = vi.hoisted(() => ({ runReferralJob: vi.fn() }));
vi.mock("@/lib/referrals/job", () => referral);
const meta = vi.hoisted(() => ({ syncMetaAds: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/marketing/sync-meta", () => meta);
const backoffice = vi.hoisted(() => ({ runBackOfficeImport: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/backoffice-import/job", () => backoffice);

import { POST } from "./route";

const tick = async () => ((await POST(new Request("http://x/api/internal/cron/tick?wait=1", { method: "POST" }))) as unknown as { body: Record<string, unknown> }).body;

describe("cron tick and the referral job", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs the referral job once per tick and reports its result under one key", async () => {
    referral.runReferralJob.mockResolvedValue({ skipped: "flag off" });
    const body = await tick();
    expect(referral.runReferralJob).toHaveBeenCalledTimes(1);
    expect(body.referral).toEqual({ skipped: "flag off" });
    expect(Object.keys(body).filter((k) => k.toLowerCase().includes("referral"))).toEqual(["referral"]);
  });

  it("a crash in the referral job is reported as an error and never stops the tick or the jobs around it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    referral.runReferralJob.mockRejectedValue(new Error("boom"));
    const body = await tick();
    expect(body.referral).toEqual({ error: "boom" });
    expect(body.auditChain).toBeDefined();
    expect(body.metaAdsSync).toBeDefined();
  });

  it("the next tick runs the job again after a failure (nothing is left latched)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    referral.runReferralJob.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ reattributed: 1, failed: 0 });
    expect((await tick()).referral).toEqual({ error: "boom" });
    expect((await tick()).referral).toEqual({ reattributed: 1, failed: 0 });
  });
});

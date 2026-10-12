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
const meta = vi.hoisted(() => ({ syncMetaAds: vi.fn() }));
vi.mock("@/lib/marketing/sync-meta", () => meta);
const backoffice = vi.hoisted(() => ({ runBackOfficeImport: vi.fn() }));
vi.mock("@/lib/backoffice-import/job", () => backoffice);

import { POST } from "./route";

describe("cron tick and the Meta Ads sync", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports exactly one metaAdsSync key, a DISABLED no-op, when the flag is unset", async () => {
    meta.syncMetaAds.mockResolvedValue({ status: "DISABLED" });
    const res = (await POST(new Request("http://x/api/internal/cron/tick?wait=1", { method: "POST" }))) as unknown as { body: Record<string, unknown> };
    expect(meta.syncMetaAds).toHaveBeenCalledTimes(1);
    expect(res.body.metaAdsSync).toEqual({ status: "DISABLED" });
    expect(Object.keys(res.body).filter((k) => k.toLowerCase().includes("meta"))).toEqual(["metaAdsSync"]);
  });

  it("a crash inside the sync never stops the tick", async () => {
    meta.syncMetaAds.mockRejectedValue(new Error("boom"));
    const res = (await POST(new Request("http://x/api/internal/cron/tick?wait=1", { method: "POST" }))) as unknown as { body: Record<string, unknown> };
    expect(res.body.metaAdsSync).toEqual({ error: "boom" });
    expect(res.body.auditChain).toBeDefined();
  });

  it("runs the back-office import as an isolated job: its result is reported and its crash never stops the tick", async () => {
    backoffice.runBackOfficeImport.mockResolvedValue({ skipped: "disabled" });
    let res = (await POST(new Request("http://x/api/internal/cron/tick?wait=1", { method: "POST" }))) as unknown as { body: Record<string, unknown> };
    expect(res.body.backofficeImport).toEqual({ skipped: "disabled" });
    backoffice.runBackOfficeImport.mockRejectedValue(new Error("boom"));
    res = (await POST(new Request("http://x/api/internal/cron/tick?wait=1", { method: "POST" }))) as unknown as { body: Record<string, unknown> };
    expect(res.body.backofficeImport).toEqual({ error: "boom" });
    expect(res.body.auditChain).toBeDefined();
  });
});

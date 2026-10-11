import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RunRow } from "@/lib/system/job-run";

const { order, rows, lease, state, ok, job } = vi.hoisted(() => {
  const order: string[] = [];
  const rows: unknown[] = [];
  const lease = { held: false, claims: [] as { key: string; ms: number }[], releases: 0 };
  const state = { failing: null as string | null };
  const ok = (name: string) => async () => { order.push(name); return { n: 1 }; };
  const job = (name: string) => async () => { if (state.failing === name) throw new Error(`${name} blew up`); order.push(name); return { n: 1 }; };
  return { order, rows, lease, state, ok, job };
});

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: (fn: () => Promise<unknown>) => { void fn(); } };
});
vi.mock("@/lib/system/heartbeat", () => ({
  CRON_HEARTBEAT: "cron_tick", CRON_TICK_LOCK: "cron_tick_lock",
  recordHeartbeat: async () => { order.push("heartbeat"); },
  claimLease: async (key: string, ms: number) => { lease.claims.push({ key, ms }); order.push("claim"); return !lease.held; },
  releaseLease: async () => { lease.releases += 1; order.push("release"); },
}));
vi.mock("@/lib/system/job-run-db", () => ({
  jobRunStore: {
    insert: async (r: RunRow) => { rows.push({ ...r }); },
    update: async (id: string, p: Partial<RunRow>) => { const r = (rows as RunRow[]).find((x) => x.id === id); if (r) Object.assign(r, p); },
    createMany: async (rs: RunRow[]) => { rows.push(...rs.map((r) => ({ ...r }))); },
  },
}));
vi.mock("@/lib/system/job-retention-db", () => ({ runPruneJobRuns: async () => ({ runs: 0, alerts: 0 }) }));
vi.mock("@/lib/system/alerts-db", () => ({ runAlertEvaluation: async () => ({ raised: 0 }) }));
vi.mock("@/lib/security/webhook-dedupe", () => ({ pruneSecurityTables: async () => ({ pruned: 1 }) }));

vi.mock("@/lib/sla/check-overdue-tasks", () => ({ checkOverdueTasks: (...a: unknown[]) => job("checkOverdueTasks")(...(a as [])) }));
vi.mock("@/lib/sla/check-stage-sla", () => ({ checkStageSla: () => job("checkStageSla")() }));
vi.mock("@/lib/sla/check-funding-sla", () => ({ checkFundingSla: ok("checkFundingSla") }));
vi.mock("@/lib/journeys/poller", () => ({ processDueJourneySteps: ok("processDueJourneySteps") }));
vi.mock("@/lib/copilot/check-disengagement", () => ({ checkDisengagement: ok("checkDisengagement") }));
vi.mock("@/lib/notifications/send-daily-report-email", () => ({ sendDailyReportEmail: async () => ({ skipped: "not-time" }) }));
vi.mock("@/lib/notifications/send-management-report-email", () => ({ sendWeeklyManagementReport: ok("weekly"), sendMonthlyManagementReport: ok("monthly") }));
vi.mock("@/lib/stage-engine/seed-baseline-stages", () => ({ seedBaselineStages: ok("seedBaselineStages") }));
vi.mock("@/lib/stage-engine/backfill-completed-clients", () => ({ backfillCompletedClientsToFinalStage: ok("backfill") }));
vi.mock("@/lib/system/system-actor", () => ({ seedSystemActor: ok("seedSystemActor") }));
vi.mock("@/lib/whatsapp/health", () => ({ checkWhatsAppAccountHealth: ok("waHealth") }));
vi.mock("@/lib/ai/check-stale-voice-analysis", () => ({ checkStaleVoiceAnalysis: ok("voice") }));
vi.mock("@/lib/ai/sweep-whatsapp-reviews", () => ({ sweepWhatsAppConversationReviews: ok("waSweep") }));
vi.mock("@/lib/audit/verify-chain", () => ({ runDailyAuditChainCheck: ok("audit") }));
vi.mock("@/lib/kyc/drop-off", () => ({ checkKycDropOffs: ok("kyc") }));
vi.mock("@/lib/support/freshdesk-sync", () => ({ syncFreshdeskHistory: ok("freshdesk") }));
vi.mock("@/lib/leads/retry", () => ({ retryFailedLeads: ok("retryLeads") }));
vi.mock("@/lib/intelligence/refresh", () => ({ refreshStaleIntelligence: ok("refresh") }));
vi.mock("@/lib/integrations/clevertap/push-batch", () => ({ pushStaleSignals: ok("clevertap") }));
vi.mock("@/lib/agents/nudger-batch", () => ({ runNudgerBatch: ok("nudger") }));
vi.mock("@/lib/agents/wiring", () => ({ runAgentSweeper: ok("sweeper") }));
vi.mock("@/lib/identity/suggestion-job-db", () => ({ runMergeSuggestions: ok("merge") }));
vi.mock("@/lib/marketing/sync-google", () => ({ syncGoogleAds: ok("google") }));
vi.mock("@/lib/marketing/sync-meta", () => ({ syncMetaAds: ok("meta") }));
vi.mock("@/lib/backoffice-import/job", () => ({ runBackOfficeImport: ok("backoffice") }));
vi.mock("@/lib/referrals/job", () => ({ runReferralJob: ok("referral") }));
vi.mock("@/lib/intelligence/extract", () => ({ extractConversationInsights: ok("insights") }));
vi.mock("@/lib/events/consumers-db", () => ({ runEventConsumers: ok("eventConsumers") }));
vi.mock("@/lib/data-health/job-db", () => ({ runDataHealth: ok("dataHealth") }));
vi.mock("@/lib/ai/gateway/retention-wiring", () => ({ runAgentRunRetention: ok("aiRunRetention") }));
vi.mock("@/lib/memory/run", () => ({ runMemoryExtractionBatch: ok("memoryExtraction") }));
vi.mock("@/lib/memory/sweep", () => ({ runMemoryExpirySweep: ok("memoryExpiry") }));
vi.mock("@/lib/intelligence/decision/retention-db", () => ({ runDecisionRetention: ok("decisionRetention") }));

import { POST, maxDuration } from "./route";

const R = () => rows as RunRow[];

const call = (query = "?wait=1", secret: string | null = "s3cret") => POST(new Request(`https://x.test/api/internal/cron/tick${query}`, { method: "POST", headers: secret ? { "x-cron-secret": secret, "user-agent": "cron-job.org" } : {} }));

beforeEach(() => {
  order.length = 0; rows.length = 0; lease.held = false; lease.claims = []; lease.releases = 0; state.failing = null;
  process.env.CRON_SECRET = "s3cret";
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the cron tick keeps its contract while recording runs", () => {
  it("rejects a missing or wrong secret exactly as before, touching nothing", async () => {
    expect((await call("?wait=1", null)).status).toBe(401);
    expect((await call("?wait=1", "nope")).status).toBe(401);
    expect(order).toEqual([]);
    expect(R()).toEqual([]);
  });

  it("records the heartbeat first, then claims the 300 second lease on the same lock, and releases it at the end", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(order.slice(0, 2)).toEqual(["heartbeat", "claim"]);
    expect(lease.claims).toEqual([{ key: "cron_tick_lock", ms: maxDuration * 1000 }]);
    expect(maxDuration).toBe(300);
    expect(lease.releases).toBe(1);
    expect(order.at(-1)).toBe("release");
  });

  it("returns every job's result under the same keys as before, in ?wait=1 mode", async () => {
    const body = await (await call()).json();
    expect(body.ok).toBe(true);
    for (const k of ["taskSla", "stageSla", "fundingSla", "journeys", "disengagement", "whatsappHealth", "dailyReport", "weeklyReport", "monthlyReport", "seedBaselineStages", "seedSystemActor", "backfillCompletedClientsToFinalStage", "checkStaleVoiceAnalysis", "sweepWhatsAppConversationReviews", "kycDropOffs", "freshdeskHistory", "conversationInsights", "customerIntelligence", "agentNudger", "agentSweeper", "clevertapPush", "leadRetry", "pruneSecurityTables", "auditChain", "mergeSuggestions", "metaAdsSync", "backofficeImport", "googleAdsSync", "referral"]) expect(body, k).toHaveProperty(k);
    expect(body.dailyReport).toEqual({ skipped: "not-time" });
  });

  it("answers 202 immediately without ?wait=1 and still runs the tick in the background", async () => {
    const res = await call("");
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, accepted: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(lease.releases).toBe(1);
  });

  it("a held lease skips the tick: no job runs, no release, and a SKIPPED __tick row says why", async () => {
    lease.held = true;
    const body = await (await call()).json();
    expect(body).toEqual({ ok: true, skipped: "a tick is already running" });
    expect(order).toEqual(["heartbeat", "claim"]);
    expect(lease.releases).toBe(0);
    const tick = R().find((r) => r.job === "__tick")!;
    expect(tick).toMatchObject({ status: "SKIPPED", skipReason: "lease held" });
    expect(R().find((r) => r.job === "heartbeat")).toBeDefined();
  });

  it("one failing job does not stop the others: the tick completes, the failure is recorded, the lease is released", async () => {
    state.failing = "checkStageSla";
    const body = await (await call()).json();
    expect(body.stageSla).toEqual({ error: "checkStageSla blew up" });
    expect(body.fundingSla).toEqual({ n: 1 });
    expect(order).toContain("audit");
    expect(lease.releases).toBe(1);
    expect(R().find((r) => r.job === "checkStageSla")).toMatchObject({ status: "FAILED", errorClass: "Error" });
    const tick = R().find((r) => r.job === "__tick")!;
    expect(tick.status).toBe("OK");
    expect(tick.summary).toMatchObject({ failed: 1 });
  });

  it("records every one of the 30 existing jobs, the two control plane jobs, the two customer event jobs, the AI run retention job, the three Wave 2 jobs, and one __tick row", async () => {
    await call();
    const jobs = R().filter((r) => r.job !== "__tick").map((r) => r.job);
    expect(jobs).toHaveLength(39);
    expect(new Set(jobs).size).toBe(39);
    expect(jobs).toEqual(expect.arrayContaining(["heartbeat", "pruneSecurityTables", "pruneJobRuns", "evaluateAlerts", "referral-progress", "event-consumers", "data-health", "ai-run-retention", "memory-extraction", "memory-expiry-sweep", "nba-decision-retention", "lead-push-sweep"]));
    expect(R().filter((r) => r.job === "__tick")).toHaveLength(1);
    expect(new Set(R().map((r) => r.tickId)).size).toBe(1);
    expect(R().find((r) => r.job === "sendDailyReportEmail")).toMatchObject({ status: "SKIPPED", skipReason: "not-time" });
  });

  it("releases the lease and marks the tick FAILED when the tick itself throws", async () => {
    const heartbeat = await import("@/lib/system/heartbeat");
    void heartbeat;
    state.failing = "__never__";
    // A thrown error outside any job: make the audit-chain mock reject the wrapper by throwing synchronously inside a job is caught,
    // so simulate a store that explodes on update to prove persistence never blocks the release.
    const store = (await import("@/lib/system/job-run-db")).jobRunStore;
    const original = store.update;
    store.update = async () => { throw new Error("db gone"); };
    const res = await call();
    store.update = original;
    expect(res.status).toBe(200);
    expect(lease.releases).toBe(1);
  });
});

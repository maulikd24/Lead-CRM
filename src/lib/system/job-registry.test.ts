import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CRON_JOBS, JOBS, WEBHOOK_JOBS, expectedIntervalMs, jobSpec } from "./job-registry";

const tick = readFileSync(join(process.cwd(), "src/app/api/internal/cron/tick/route.ts"), "utf8");
const tickKeys = [...tick.matchAll(/runJob\("([^"]+)"/g)].map((m) => m[1]);

describe("the job registry is the single list of jobs", () => {
  it("has every job the tick runs, and the tick runs every registered cron job", () => {
    expect(tickKeys.length).toBeGreaterThanOrEqual(30);
    expect(tickKeys.filter((k) => !CRON_JOBS.some((j) => j.key === k)).sort()).toEqual([]);
    expect(CRON_JOBS.map((j) => j.key).filter((k) => !tickKeys.includes(k)).sort()).toEqual([]);
  });
  it("has the 30 existing cron jobs plus the two the control plane adds, the AI gateway retention job, the two Wave 1 event jobs and the three Wave 2 jobs (memory extraction, memory expiry, decision retention)", () => {
    expect(CRON_JOBS).toHaveLength(42);
    expect(CRON_JOBS.map((j) => j.key)).toEqual(expect.arrayContaining(["pruneJobRuns", "evaluateAlerts", "ai-run-retention", "event-consumers", "data-health", "memory-extraction", "memory-expiry-sweep", "nba-decision-retention", "lead-push-sweep", "closed-loop-conversions", "autopilot-daily-audit", "autopilot-weekly-digest"]));
    // each Wave 2 job is behind the flag of the feature it serves, so with the flag off the tick records it as SKIPPED
    expect(jobSpec("memory-extraction")?.flag).toBe("MEMORY_EXTRACTION_ENABLED");
    expect(jobSpec("memory-expiry-sweep")?.flag).toBe("NEXT_PUBLIC_MEMORY");
    expect(jobSpec("nba-decision-retention")?.flag).toBe("NBA_ENGINE_V2");
  });
  it("has the 11 webhook and ingest routes", () => expect(WEBHOOK_JOBS).toHaveLength(11));
  it("has unique keys, a label, an owner and a kind that matches its list", () => {
    const keys = JOBS.map((j) => j.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const j of JOBS) {
      expect(j.label.length, j.key).toBeGreaterThan(3);
      expect(j.owner.length, j.key).toBeGreaterThan(1);
      expect(j.expectedMaxMs, j.key).toBeGreaterThan(0);
    }
    expect(CRON_JOBS.every((j) => j.kind === "CRON")).toBe(true);
    expect(WEBHOOK_JOBS.every((j) => j.kind === "WEBHOOK" && j.key.startsWith("webhook:"))).toBe(true);
  });
  it("never marks a job that sends a message or an email as safe to run again", () => {
    const sends = ["agent-nudger", "sendDailyReportEmail", "sendWeeklyManagementReport", "sendMonthlyManagementReport", "clevertap-push", "referral-progress", "checkDisengagement", "processDueJourneySteps", "memory-extraction", "lead-push-sweep", "autopilot-weekly-digest"]; // memory-extraction reads conversations through a model (it spends money): never re-run by hand
    for (const k of sends) expect(jobSpec(k)?.safeToRun, k).toBe(false);
  });
  it("marks exactly the idempotent jobs the pack lists as safe to run again", () => {
    const safe = CRON_JOBS.filter((j) => j.safeToRun).map((j) => j.key).sort();
    expect(safe).toEqual(["ai-run-retention", "autopilot-daily-audit", "backoffice-import", "data-health", "event-consumers", "google-ads-sync", "memory-expiry-sweep", "merge-suggestions", "meta-ads-sync", "nba-decision-retention", "pruneJobRuns", "pruneSecurityTables", "refreshStaleIntelligence", "retryFailedLeads", "runDailyAuditChainCheck"]);
  });
  it("never lets a webhook be retried by hand", () => expect(WEBHOOK_JOBS.some((j) => j.safeToRun)).toBe(false));
  it("knows cadence", () => {
    expect(expectedIntervalMs(jobSpec("checkOverdueTasks")!.cadence)).toBe(5 * 60_000);
    expect(expectedIntervalMs(jobSpec("sendDailyReportEmail")!.cadence)).toBe(24 * 3_600_000);
    expect(expectedIntervalMs({ everyHours: 6 })).toBe(6 * 3_600_000);
  });
});

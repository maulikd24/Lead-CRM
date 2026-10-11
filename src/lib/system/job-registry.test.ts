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
  it("has the 30 existing cron jobs plus the two the control plane adds", () => {
    expect(CRON_JOBS).toHaveLength(34);
    expect(CRON_JOBS.map((j) => j.key)).toEqual(expect.arrayContaining(["pruneJobRuns", "evaluateAlerts"]));
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
    const sends = ["agent-nudger", "sendDailyReportEmail", "sendWeeklyManagementReport", "sendMonthlyManagementReport", "clevertap-push", "referral-progress", "checkDisengagement", "processDueJourneySteps"];
    for (const k of sends) expect(jobSpec(k)?.safeToRun, k).toBe(false);
  });
  it("marks exactly the idempotent jobs the pack lists as safe to run again", () => {
    const safe = CRON_JOBS.filter((j) => j.safeToRun).map((j) => j.key).sort();
    expect(safe).toEqual(["backoffice-import", "data-health", "event-consumers", "google-ads-sync", "merge-suggestions", "meta-ads-sync", "pruneJobRuns", "pruneSecurityTables", "refreshStaleIntelligence", "retryFailedLeads", "runDailyAuditChainCheck"]);
  });
  it("never lets a webhook be retried by hand", () => expect(WEBHOOK_JOBS.some((j) => j.safeToRun)).toBe(false));
  it("knows cadence", () => {
    expect(expectedIntervalMs(jobSpec("checkOverdueTasks")!.cadence)).toBe(5 * 60_000);
    expect(expectedIntervalMs(jobSpec("sendDailyReportEmail")!.cadence)).toBe(24 * 3_600_000);
    expect(expectedIntervalMs({ everyHours: 6 })).toBe(6 * 3_600_000);
  });
});

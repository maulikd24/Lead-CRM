import { describe, expect, it } from "vitest";

import { buildIntegrationRows, buildJobRows, nextDueAt, overallStrip, successRate, trendOf, type JobRaw } from "./control-plane-model";
import { jobSpec } from "./job-registry";

const NOW = new Date("2027-04-20T12:00:00Z");
const ago = (m: number) => new Date(NOW.getTime() - m * 60_000);

const raw = (over: Partial<JobRaw> = {}): JobRaw => ({ latest: null, stats: null, recent: [], ...over });

describe("successRate", () => {
  it("is OK over OK plus failed, ignoring skipped, and null when nothing ran", () => {
    expect(successRate(9, 1)).toBeCloseTo(0.9);
    expect(successRate(0, 0)).toBeNull();
  });
});

describe("nextDueAt", () => {
  it("is five minutes after the last run for a tick job and null for a webhook", () => {
    expect(nextDueAt(jobSpec("checkStageSla")!, ago(2), NOW)).toEqual(new Date(ago(2).getTime() + 300_000));
    expect(nextDueAt(jobSpec("webhook:leads-web")!, ago(2), NOW)).toBeNull();
  });
  it("is a day after the last alive run for a daily job and 'now' for a job never seen", () => {
    expect(nextDueAt(jobSpec("runDailyAuditChainCheck")!, ago(60), NOW)!.getTime()).toBe(ago(60).getTime() + 24 * 3_600_000);
    expect(nextDueAt(jobSpec("checkStageSla")!, null, NOW)).toEqual(NOW);
  });
});

describe("trendOf", () => {
  it("compares the recent half with the earlier half", () => {
    expect(trendOf([100, 100, 100, 100, 300, 300, 300, 300])).toBe("slower");
    expect(trendOf([300, 300, 300, 300, 100, 100, 100, 100])).toBe("faster");
    expect(trendOf([100, 105, 98, 102])).toBe("steady");
    expect(trendOf([100])).toBe("steady");
  });
});

describe("buildJobRows", () => {
  const specs = [jobSpec("checkStageSla")!, jobSpec("meta-ads-sync")!, jobSpec("checkFundingSla")!, jobSpec("seedSystemActor")!];
  const data = new Map<string, JobRaw>([
    ["checkStageSla", raw({ latest: { status: "FAILED", startedAt: ago(3), durationMs: 900, errorClass: "TypeError", skipReason: null, attempt: 1 }, stats: { ok24: 100, bad24: 3, ok7: 600, bad7: 3, lastOkAt: ago(30), lastAliveAt: ago(30) }, recent: [{ status: "FAILED", durationMs: 900 }, { status: "FAILED", durationMs: 800 }, { status: "FAILED", durationMs: 700 }, { status: "OK", durationMs: 600 }] })],
    ["meta-ads-sync", raw({ latest: { status: "SKIPPED", startedAt: ago(3), durationMs: 2, errorClass: null, skipReason: "flag off", attempt: 1 }, stats: { ok24: 0, bad24: 0, ok7: 0, bad7: 0, lastOkAt: null, lastAliveAt: ago(3) }, recent: [] })],
    ["checkFundingSla", raw({ latest: { status: "OK", startedAt: ago(40), durationMs: 25_000, errorClass: null, skipReason: null, attempt: 1 }, stats: { ok24: 280, bad24: 0, ok7: 2000, bad7: 0, lastOkAt: ago(40), lastAliveAt: ago(40) }, recent: [{ status: "OK", durationMs: 25_000 }] })],
  ]);
  const rows = buildJobRows(specs, data, {}, NOW);
  const by = (k: string) => rows.find((r) => r.key === k)!;
  it("flags a job failing 3 times in a row, with its last error class and success rates", () => {
    expect(by("checkStageSla")).toMatchObject({ state: "failing", consecutiveFailures: 3, lastErrorClass: "TypeError" });
    expect(by("checkStageSla").rate24h).toBeCloseTo(100 / 103);
  });
  it("says 'flag off' for a skipped flagged job and 'not yet seen' for one with no rows", () => {
    expect(by("meta-ads-sync").state).toBe("flag-off");
    expect(by("seedSystemActor").state).toBe("not-seen");
  });
  it("marks a tick job that has not run for 2x its cadence as late", () => expect(by("checkFundingSla").state).toBe("late"));
  it("computes budget share of the 300 second window", () => expect(by("checkFundingSla").budgetShare).toBeCloseTo(25 / 300));
  it("lists failing first, then late, then the rest", () => expect(rows.map((r) => r.key).slice(0, 2)).toEqual(["checkStageSla", "checkFundingSla"]));
});

describe("buildIntegrationRows", () => {
  it("merges the System status list with the feeding jobs and a settings link, and shows no secret field", () => {
    const rows = buildIntegrationRows(
      [{ key: "meta_ads", label: "Meta Ads", state: "connected", note: "Live, enabled, credentials saved (not tested here)" }, { key: "clickup", label: "ClickUp", state: "mock", note: "Mock mode" }],
      new Map([["meta-ads-sync", { lastSuccessAt: ago(60), lastErrorAt: null, lastErrorClass: null, consecutiveFailures: 0, failures24h: 0 }]]),
      NOW,
    );
    expect(rows[0]).toMatchObject({ key: "meta_ads", state: "HEALTHY", settingsHref: "/settings/integrations", feeds: [{ job: "meta-ads-sync" }] });
    expect(rows[1].state).toBe("MOCK");
    expect(JSON.stringify(rows)).not.toMatch(/credential(s)?":|secret|password|token/i);
  });
});

describe("overallStrip", () => {
  it("is red with a critical alert or a stale scheduler, amber with attention items, green otherwise, and always counts what needs attention", () => {
    expect(overallStrip({ openAlerts: [{ severity: "CRITICAL" }], attention: 0, failingJobs: 0, badIntegrations: 0 }).tone).toBe("bad");
    expect(overallStrip({ openAlerts: [], attention: 2, failingJobs: 1, badIntegrations: 0 })).toMatchObject({ tone: "warn", needsAttention: 3 });
    expect(overallStrip({ openAlerts: [], attention: 0, failingJobs: 0, badIntegrations: 0 })).toMatchObject({ tone: "ok", needsAttention: 0 });
  });
});

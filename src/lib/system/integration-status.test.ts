import { describe, expect, it } from "vitest";

import { INTEGRATION_FEEDS } from "./integration-map";
import { classifyIssue, computeIntegrationState, type FeedStats } from "./integration-status";

const NOW = new Date("2027-04-20T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const stats = (over: Partial<FeedStats> = {}): FeedStats => ({ lastSuccessAt: hoursAgo(1), lastErrorAt: null, lastErrorClass: null, consecutiveFailures: 0, failures24h: 0, ...over });
const conn = { base: "connected" as const, note: "Live, enabled, credentials saved (not tested here)" };
const SIX_H = 6 * 3_600_000;
const run = (base: { base: "connected" | "needs_setup" | "mock" | "flag_off"; note: string }, s: FeedStats | null, interval: number | null = SIX_H, hasFeeds = true) => computeIntegrationState({ ...base, stats: s, intervalMs: interval, hasFeeds, now: NOW });

describe("integration state, first match wins", () => {
  it("FLAG_OFF when the gating flag is off", () => expect(run({ base: "flag_off", note: "Off: X is not 1" }, stats()).state).toBe("FLAG_OFF"));
  it("NOT_CONFIGURED when live was chosen but credentials are missing", () => expect(run({ base: "needs_setup", note: "Live but no credentials saved" }, null).state).toBe("NOT_CONFIGURED"));
  it("DISABLED when live but switched off", () => expect(run({ base: "needs_setup", note: "Live but disabled" }, null).state).toBe("DISABLED"));
  it("MOCK in mock mode, however many failures its jobs show", () => expect(run({ base: "mock", note: "Mock mode" }, stats({ consecutiveFailures: 9 })).state).toBe("MOCK"));
  it("DOWN after 3 failures in a row", () => expect(run(conn, stats({ consecutiveFailures: 3, lastErrorAt: hoursAgo(0.1), lastErrorClass: "Error" })).state).toBe("DOWN"));
  it("DOWN when nothing has succeeded for more than 4x the interval", () => expect(run(conn, stats({ lastSuccessAt: hoursAgo(25) })).state).toBe("DOWN"));
  it("DEGRADED when the last error is newer than the last success", () => expect(run(conn, stats({ lastErrorAt: hoursAgo(0.5), lastErrorClass: "FetchTimeout", failures24h: 1 })).state).toBe("DEGRADED"));
  it("DEGRADED with a failure in the last 24 hours even after a later success", () => expect(run(conn, stats({ failures24h: 1, lastErrorAt: hoursAgo(5) })).state).toBe("DEGRADED"));
  it("DEGRADED when the last success is between 2x and 4x the interval old", () => expect(run(conn, stats({ lastSuccessAt: hoursAgo(14) })).state).toBe("DEGRADED"));
  it("DEGRADED on a rate-limit class error", () => expect(run(conn, stats({ lastErrorAt: hoursAgo(20), lastErrorClass: "Http429" })).state).toBe("DEGRADED"));
  it("UNTESTED when live and saved but no job has ever succeeded", () => {
    const r = run(conn, stats({ lastSuccessAt: null }));
    expect(r.state).toBe("UNTESTED");
    expect(r.reason).toMatch(/no successful call recorded yet/i);
  });
  it("UNTESTED with the honest sentence when nothing feeds it", () => expect(run(conn, null, null, false).reason).toMatch(/nothing here tests it/i));
  it("HEALTHY when it succeeded within its interval and nothing failed since", () => expect(run(conn, stats()).state).toBe("HEALTHY"));
  it("does not apply a staleness rule to an event-driven integration", () => expect(run(conn, stats({ lastSuccessAt: hoursAgo(500) }), null).state).toBe("HEALTHY"));
});

describe("classifyIssue", () => {
  it("names rate limits and auth problems from error classes, never from messages", () => {
    expect(classifyIssue("Http429")).toBe("rate-limit");
    expect(classifyIssue("RateLimitError")).toBe("rate-limit");
    expect(classifyIssue("Http401")).toBe("auth");
    expect(classifyIssue("AuthenticationError")).toBe("auth");
    expect(classifyIssue("TypeError")).toBeNull();
    expect(classifyIssue(null)).toBeNull();
  });
});

describe("integration map", () => {
  it("only names jobs that exist, and a settings link for every integration", async () => {
    const { JOBS } = await import("./job-registry");
    for (const [key, f] of Object.entries(INTEGRATION_FEEDS)) {
      for (const j of f.jobs) expect(JOBS.some((x) => x.key === j), `${key} -> ${j}`).toBe(true);
      expect(f.settingsHref.startsWith("/settings/"), key).toBe(true);
    }
  });
  it("feeds Meta and Google from their sync jobs at a 6 hour interval", () => {
    expect(INTEGRATION_FEEDS.meta_ads).toMatchObject({ jobs: ["meta-ads-sync"], everyHours: 6 });
    expect(INTEGRATION_FEEDS.google_ads).toMatchObject({ jobs: ["google-ads-sync"], everyHours: 6 });
  });
});

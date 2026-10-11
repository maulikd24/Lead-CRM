/**
 * One state per integration, computed from the System status base state (flag, mode, credentials: status.ts) refined with what the
 * feeding jobs actually did (JobRun). First match wins:
 *   FLAG_OFF, NOT_CONFIGURED, DISABLED, MOCK, DOWN, DEGRADED, UNTESTED, HEALTHY.
 * Pure. Error CLASSES only: no message, no secret, no credential is ever read here.
 */
import type { IntegrationStateName } from "./alerts";

export type BaseState = "connected" | "needs_setup" | "mock" | "flag_off";

export type FeedStats = {
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorClass: string | null;
  consecutiveFailures: number;
  failures24h: number;
};

export type IntegrationVerdict = { state: IntegrationStateName; reason: string; issue: "rate-limit" | "auth" | null };

const H = 3_600_000;

export function classifyIssue(errorClass: string | null): "rate-limit" | "auth" | null {
  if (!errorClass) return null;
  if (/429|rate.?limit|too.?many/i.test(errorClass)) return "rate-limit";
  if (/401|403|auth|unauthori[sz]ed|forbidden|token/i.test(errorClass)) return "auth";
  return null;
}

export function computeIntegrationState(i: { base: BaseState; note: string; stats: FeedStats | null; intervalMs: number | null; hasFeeds: boolean; now: Date }): IntegrationVerdict {
  const none = { issue: null } as const;
  if (i.base === "flag_off") return { state: "FLAG_OFF", reason: i.note, ...none };
  if (i.base === "needs_setup") return /disabled/i.test(i.note) ? { state: "DISABLED", reason: "Live mode, switched off in Settings", ...none } : { state: "NOT_CONFIGURED", reason: i.note, ...none };
  if (i.base === "mock") return { state: "MOCK", reason: "Mock mode: no real calls are made", ...none };

  const s = i.stats;
  const issue = classifyIssue(s?.lastErrorClass ?? null);
  if (!i.hasFeeds || !s) return { state: "UNTESTED", reason: "Settings are in place; nothing here tests it", ...none };

  const age = s.lastSuccessAt ? i.now.getTime() - s.lastSuccessAt.getTime() : null;
  const stale4 = i.intervalMs && age !== null && age > 4 * i.intervalMs;
  const stale2 = i.intervalMs && age !== null && age > 2 * i.intervalMs;
  if (s.consecutiveFailures >= 3) return { state: "DOWN", reason: `The last ${s.consecutiveFailures} runs failed${s.lastErrorClass ? ` (${s.lastErrorClass})` : ""}`, issue };
  if (stale4) return { state: "DOWN", reason: `No success for ${Math.round((age as number) / H)} hours`, issue };
  const errorNewer = s.lastErrorAt && (!s.lastSuccessAt || s.lastErrorAt > s.lastSuccessAt);
  if (errorNewer) return { state: "DEGRADED", reason: `The latest run failed${s.lastErrorClass ? ` (${s.lastErrorClass})` : ""}`, issue };
  if (s.failures24h >= 1) return { state: "DEGRADED", reason: `${s.failures24h} failure${s.failures24h === 1 ? "" : "s"} in the last 24 hours`, issue };
  if (stale2) return { state: "DEGRADED", reason: `Last success ${Math.round((age as number) / H)} hours ago, later than expected`, issue };
  if (issue === "rate-limit") return { state: "DEGRADED", reason: "Rate limited recently", issue };
  if (!s.lastSuccessAt) return { state: "UNTESTED", reason: "Live and saved, but no successful call recorded yet", ...none };
  return { state: "HEALTHY", reason: "Succeeded within its expected interval", issue: null };
}

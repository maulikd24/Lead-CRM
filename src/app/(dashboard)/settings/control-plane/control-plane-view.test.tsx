import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./actions", () => ({ retryJobAction: vi.fn(), retryLeadsAction: vi.fn(), acknowledgeAlertAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(""), usePathname: () => "/settings/control-plane", useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

import type { AlertRow } from "@/lib/system/control-plane-read";
import type { IntegrationRow, JobRow } from "@/lib/system/control-plane-model";
import type { FailureGroup } from "@/lib/system/failures";
import type { SystemStatus } from "@/lib/system/status";
import { FailuresView, HealthView, IntegrationsView, JobsView, PanelError, StripView } from "./control-plane-view";

const NOW = new Date("2027-04-20T12:00:00Z");
const ago = (m: number) => new Date(NOW.getTime() - m * 60_000);

const status: SystemStatus = {
  generatedAt: NOW.toISOString(),
  app: { commit: "0123456789abcdef", shortCommit: "0123456", branch: "main", deployEnv: "production", nodeEnv: "production" },
  database: { connected: true, name: "db1", serverVersion: "16.4", latencyMs: 7 },
  migrations: { applied: 64, failed: [], latest: "20270410000000_control_plane_job_run", pending: 0, onDisk: 64 },
  flags: { on: [{ name: "NEXT_PUBLIC_CONTROL_PLANE", label: "Control plane", buildTime: true }], off: ["SSO_ENABLED"], settings: [], check: { errors: 0, warnings: 1, findings: [] } },
  cron: { tick: { state: "ticking", minutesAgo: 2 }, jobs: [{ name: "ad_sync:meta", lastRunAt: ago(90).toISOString() }] },
  queues: [{ key: "whatsapp_outbox", label: "WhatsApp messages waiting to send", depth: 4, oldestMinutes: 35, level: "attention" }],
  integrations: [], env: [], attention: ["WhatsApp messages waiting to send: the oldest item has waited 35 minutes."],
};
const alert = (over: Partial<AlertRow> = {}): AlertRow => ({ id: "a1", key: "heartbeat-stale", severity: "CRITICAL", title: "The scheduler has not ticked for 40 minutes", detail: { ageMinutes: 40 }, firstRaisedAt: ago(40), lastSeenAt: ago(1), acknowledgedAt: null, ...over });
const ok = <T,>(data: T) => ({ ok: true as const, data });
const health = (over: Record<string, unknown> = {}) => ({
  tablesMissing: false, status: ok(status),
  tick: ok({ heartbeatMinutes: 2, heartbeatState: "ticking" as const, last: { id: "t1", status: "OK", durationMs: 41_000, startedAt: ago(3), skipReason: null, summary: null }, skippedInARow: 0, windowShare: 0.14, abandoned: 0 }),
  jobsLastTick: ok({ ok: 20, failed: 1, skipped: 9, notReached: 0, ranAt: ago(3) }),
  whatsapp: ok({ accounts: 3, withError: 1, lastInboundAt: ago(4) }),
  freshness: ok([{ name: "Meta ad sync", at: ago(90) }, { name: "Google ad sync", at: null }]),
  audit: ok({ lastStatus: "OK", lastAt: ago(600) }),
  alerts: ok([alert()]), release: { sha: "0123456", branch: "main", env: "production" },
  ...over,
});

describe("StripView", () => {
  it("leads with one sentence, the count, and the age of the data, with the state in words", () => {
    const html = renderToStaticMarkup(<StripView data={{ strip: { tone: "warn", word: "Needs attention", needsAttention: 3 }, alerts: [], generatedAt: NOW, alertsPanel: ok(true) }} now={NOW} />);
    expect(html).toContain("3 things need attention");
    expect(html).toContain("Updated");
    expect(html).toContain("Refresh");
  });
  it("says all clear when nothing needs attention", () => {
    const html = renderToStaticMarkup(<StripView data={{ strip: { tone: "ok", word: "All clear", needsAttention: 0 }, alerts: [], generatedAt: NOW, alertsPanel: ok(true) }} now={NOW} />);
    expect(html).toContain("All clear");
  });
});

describe("HealthView", () => {
  const html = renderToStaticMarkup(<HealthView health={health()} now={NOW} />);
  it("shows the tiles with their state in words, not only colour", () => {
    for (const w of ["Scheduler", "Database", "Jobs in the last tick", "Queues", "WhatsApp", "Data freshness", "Audit chain", "Flags", "Release"]) expect(html, w).toContain(w);
    expect(html).toMatch(/Ticking/);
    expect(html).toContain("0123456");
    expect(html).toContain("1 warning");
  });
  it("lists the open alert, an acknowledge control and an email DRAFT for a critical one that is addressed to nobody", () => {
    expect(html).toContain("The scheduler has not ticked for 40 minutes");
    expect(html).toContain("Acknowledge");
    expect(html).toContain("Email draft");
    expect(html).toContain("mailto:?subject=");
    expect(html).toContain("Nothing is sent");
  });
  it("lists the 14 diagnosis questions with how much each is answered", () => {
    expect(html).toContain("Is the cron tick running?");
    expect(html).toContain("Not built yet");
  });
  it("says what to do when no run has been recorded yet", () => {
    const empty = renderToStaticMarkup(<HealthView health={health({ tick: ok({ heartbeatMinutes: 2, heartbeatState: "ticking", last: null, skippedInARow: 0, windowShare: null, abandoned: 0 }), jobsLastTick: ok(null), alerts: ok([]) })} now={NOW} />);
    expect(empty).toContain("No runs recorded yet");
    expect(empty).toContain("next cron tick");
    expect(empty).toContain("No open alerts");
  });
  it("shows a banner when the tables are not installed, and still renders the other panels", () => {
    const banner = renderToStaticMarkup(<HealthView health={health({ tablesMissing: true, tick: { ok: false, errorClass: "TablesMissing", tablesMissing: true }, alerts: { ok: false, errorClass: "TablesMissing", tablesMissing: true } })} now={NOW} />);
    expect(banner).toContain("Control plane tables are not installed");
    expect(banner).toContain("Database");
  });
  it("shows one failing panel as a short error and keeps the rest", () => {
    const partial = renderToStaticMarkup(<HealthView health={health({ whatsapp: { ok: false, errorClass: "Timeout", tablesMissing: false } })} now={NOW} />);
    expect(partial).toContain("Could not read");
    expect(partial).toContain("Timeout");
    expect(partial).toContain("Database");
  });
});

const jobRow = (over: Partial<JobRow> = {}): JobRow => ({
  key: "checkStageSla", label: "Stage SLA warnings", owner: "Pipeline", cadence: "Every tick (5 min)", kind: "CRON", state: "ok", lastRunAt: ago(3), lastStatus: "OK", lastDurationMs: 1200,
  rate24h: 0.99, rate7d: 0.97, consecutiveFailures: 0, lastErrorClass: null, lastSuccessAt: ago(3), nextDueAt: new Date(NOW.getTime() + 120_000), budgetShare: 0.004, durations: [1000, 1100, 1200, 1300], trend: "steady", safeToRun: false, skipReason: null, ...over,
});

describe("JobsView", () => {
  it("shows every job with cadence, last run, duration, success rates and next due, failing first", () => {
    const html = renderToStaticMarkup(<JobsView jobs={{ cron: [jobRow({ key: "bad", label: "Failing one", state: "failing", lastStatus: "FAILED", lastErrorClass: "TypeError", consecutiveFailures: 3 }), jobRow()], webhooks: [jobRow({ key: "webhook:leads-web", label: "Website lead form", kind: "WEBHOOK", cadence: "On request", nextDueAt: null })], tablesSeen: true }} now={NOW} />);
    expect(html).toContain("Failing one");
    expect(html).toContain("TypeError");
    expect(html).toContain("99%");
    expect(html).toContain("Every tick (5 min)");
    expect(html).toContain("Website lead form");
    expect(html).toContain("Failing");
    expect(html.indexOf("Failing one")).toBeLessThan(html.indexOf("Stage SLA warnings"));
  });
  it("labels a flagged-off job and one never seen", () => {
    const html = renderToStaticMarkup(<JobsView jobs={{ cron: [jobRow({ key: "meta-ads-sync", label: "Meta ad-spend sync", state: "flag-off", lastStatus: "SKIPPED", skipReason: "flag off" }), jobRow({ key: "x", label: "Never seen job", state: "not-seen", lastRunAt: null, lastStatus: null })], webhooks: [], tablesSeen: true }} now={NOW} />);
    expect(html).toContain("Flag off");
    expect(html).toContain("Not seen yet");
  });
});

const group = (over: Partial<FailureGroup> = {}): FailureGroup => ({
  key: "job|meta-ads-sync|Http429", source: "job", group: "meta-ads-sync", label: "Meta ad-spend sync", errorClass: "Http429", reason: "Failed with Http429", firstSeen: ago(300), lastSeen: ago(5), count: 4, attempts: 1,
  stillFailing: true, dead: false, retry: { kind: "job", targetIds: ["run9"] }, dataRisk: "none", dataNote: "Runs again on a schedule", link: { href: "/settings/control-plane?tab=jobs", label: "Open in Jobs" }, ...over,
});

describe("FailuresView", () => {
  it("groups failures with first seen, last seen, count, still-failing state, a retry and the customer data indicator in words", () => {
    const html = renderToStaticMarkup(<FailuresView groups={[group(), group({ key: "k2", source: "webhook", group: "webhook:meta-leads", label: "Meta lead-form webhook", errorClass: "Http500", dataRisk: "at-risk", retry: null, stillFailing: false })]} now={NOW} />);
    expect(html).toContain("Http429");
    expect(html).toContain("4 failures");
    expect(html).toContain("Still failing");
    expect(html).toContain("Recovered");
    expect(html).toContain("Retry");
    expect(html).toContain("Customer data");
    expect(html).toContain("not lost");
    expect(html).toContain("may be lost");
  });
  it("says plainly when nothing failed", () => expect(renderToStaticMarkup(<FailuresView groups={[]} now={NOW} />)).toContain("No failures in the last 7 days"));
});

const integ = (over: Partial<IntegrationRow> = {}): IntegrationRow => ({ key: "meta_ads", label: "Meta Ads", state: "DEGRADED", reason: "The latest run failed (Http429)", issue: "rate-limit", lastSuccessAt: ago(400), lastErrorAt: ago(10), lastErrorClass: "Http429", settingsHref: "/settings/integrations", note: null, feeds: [{ job: "meta-ads-sync", label: "Meta ad-spend sync" }], ...over });

describe("IntegrationsView", () => {
  it("shows state in words, last success, last error class, the rate-limit issue, the feeding jobs and a settings link, and never a secret", () => {
    const html = renderToStaticMarkup(<IntegrationsView rows={[integ(), integ({ key: "clickup", label: "ClickUp", state: "MOCK", reason: "Mock mode", issue: null, lastSuccessAt: null, lastErrorAt: null, lastErrorClass: null, feeds: [] })]} now={NOW} />);
    expect(html).toContain("Needs a look");
    expect(html).toContain("Mock");
    expect(html).toContain("Rate limited");
    expect(html).toContain("Http429");
    expect(html).toContain("/settings/integrations");
    expect(html).toContain("Meta ad-spend sync");
    expect(html).not.toMatch(/password|secret|api[_ -]?key|bearer/i);
  });
  it("shows no last success or feeding jobs for a mock or switched-off integration", () => {
    const html = renderToStaticMarkup(<IntegrationsView rows={[integ({ key: "exotel", label: "Exotel calls", state: "MOCK", reason: "Mock mode", issue: null, lastSuccessAt: ago(3), feeds: [{ job: "checkStaleVoiceAnalysis", label: "Stale call analysis" }] })]} now={NOW} />);
    expect(html).toContain("Mock mode");
    expect(html).not.toContain("Last success");
    expect(html).not.toContain("Stale call analysis");
  });
});

describe("PanelError", () => {
  it("shows a class name, never a driver message", () => {
    const html = renderToStaticMarkup(<PanelError name="Jobs" error={{ ok: false, errorClass: "PrismaClientKnownRequestError", tablesMissing: false }} />);
    expect(html).toContain("Could not read Jobs");
    expect(html).toContain("PrismaClientKnownRequestError");
  });
});

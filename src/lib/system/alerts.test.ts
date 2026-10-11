import { describe, expect, it } from "vitest";

import { DEFAULT_ALERT_CONFIG, loadAlertConfig } from "./alert-config";
import { buildAlertEmailDraft, evaluateRules, reconcileAlerts, type AlertFacts, type DesiredAlert, type OpenAlert } from "./alerts";
import { jobSpec } from "./job-registry";

const NOW = new Date("2027-04-20T12:00:00Z");
const mins = (n: number) => new Date(NOW.getTime() - n * 60_000);

function facts(over: Partial<AlertFacts> = {}): AlertFacts {
  return { now: NOW, heartbeatAgeMs: 60_000, jobs: [], ticks: [], whatsappOutbox: { depth: 0, oldestMinutes: null }, leadIntake: { failed24h: 0, oldestUnretriedMinutes: null }, integrations: [], rejectedWebhooks: {}, persistFailedTicks: 0, abandonedTicks: 0, ...over };
}
const jobFact = (key: string, statuses: string[], lastAliveAt: Date | null = mins(1), flagOn = true) => ({ spec: jobSpec(key)!, recent: statuses, lastAliveAt, flagOn });
const cfg = DEFAULT_ALERT_CONFIG;
const find = (alerts: DesiredAlert[], key: string) => alerts.find((a) => a.key === key);

describe("thresholds", () => {
  it("have safe defaults", () => {
    expect(cfg.heartbeatStaleMs).toBe(15 * 60_000);
    expect(cfg.jobFailingConsecutive).toBe(3);
    expect(cfg.outbox).toEqual({ depth: 50, oldestMinutes: 30 });
  });
  it("can be overridden from the environment, within sane bounds, and ignore junk", () => {
    const c = loadAlertConfig({ CONTROL_PLANE_ALERT_JOB_FAILING_CONSECUTIVE: "5", CONTROL_PLANE_ALERT_OUTBOX_DEPTH: "abc", CONTROL_PLANE_ALERT_HEARTBEAT_STALE_MINUTES: "0" });
    expect(c.jobFailingConsecutive).toBe(5);
    expect(c.outbox.depth).toBe(50);
    expect(c.heartbeatStaleMs).toBe(15 * 60_000); // 0 is out of bounds
    expect(loadAlertConfig({ CONTROL_PLANE_ALERT_JOB_FAILING_CONSECUTIVE: "9999" }).jobFailingConsecutive).toBe(cfg.jobFailingConsecutive);
  });
});

describe("heartbeat-stale", () => {
  it("raises CRITICAL past the threshold and not below it", () => {
    expect(find(evaluateRules(facts({ heartbeatAgeMs: 16 * 60_000 }), cfg), "heartbeat-stale")).toMatchObject({ severity: "CRITICAL" });
    expect(find(evaluateRules(facts({ heartbeatAgeMs: 14 * 60_000 }), cfg), "heartbeat-stale")).toBeUndefined();
  });
  it("treats a heartbeat that has never been seen as stale", () => expect(find(evaluateRules(facts({ heartbeatAgeMs: null }), cfg), "heartbeat-stale")).toBeDefined());
});

describe("job-failing", () => {
  it("raises when the last 3 runs that happened all failed", () => {
    const a = evaluateRules(facts({ jobs: [jobFact("checkStageSla", ["FAILED", "TIMEOUT", "FAILED", "OK"])] }), cfg);
    expect(find(a, "job-failing:checkStageSla")).toMatchObject({ severity: "WARN", detail: { job: "checkStageSla", consecutive: 3 } });
  });
  it("does not raise for two failures, or when a success interrupts them", () => {
    expect(find(evaluateRules(facts({ jobs: [jobFact("checkStageSla", ["FAILED", "FAILED", "OK"])] }), cfg), "job-failing:checkStageSla")).toBeUndefined();
    expect(find(evaluateRules(facts({ jobs: [jobFact("checkStageSla", ["FAILED", "OK", "FAILED", "FAILED"])] }), cfg), "job-failing:checkStageSla")).toBeUndefined();
  });
  it("is CRITICAL for the audit chain check and lead retries", () => {
    for (const k of ["runDailyAuditChainCheck", "retryFailedLeads"]) expect(find(evaluateRules(facts({ jobs: [jobFact(k, ["FAILED", "FAILED", "FAILED"])] }), cfg), `job-failing:${k}`)?.severity).toBe("CRITICAL");
  });
  it("honours a configured N", () => {
    const c = { ...cfg, jobFailingConsecutive: 2 };
    expect(find(evaluateRules(facts({ jobs: [jobFact("checkStageSla", ["FAILED", "FAILED"])] }), c), "job-failing:checkStageSla")).toBeDefined();
  });
});

describe("job-late", () => {
  it("raises when a tick job has not been alive for 2x its cadence", () => {
    expect(find(evaluateRules(facts({ jobs: [jobFact("checkStageSla", ["OK"], mins(11))] }), cfg), "job-late:checkStageSla")).toBeDefined();
    expect(find(evaluateRules(facts({ jobs: [jobFact("checkStageSla", ["OK"], mins(9))] }), cfg), "job-late:checkStageSla")).toBeUndefined();
  });
  it("uses 30 hours for a daily job", () => {
    expect(find(evaluateRules(facts({ jobs: [jobFact("runDailyAuditChainCheck", ["OK"], mins(29 * 60))] }), cfg), "job-late:runDailyAuditChainCheck")).toBeUndefined();
    expect(find(evaluateRules(facts({ jobs: [jobFact("runDailyAuditChainCheck", ["OK"], mins(31 * 60))] }), cfg), "job-late:runDailyAuditChainCheck")).toBeDefined();
  });
  it("ignores a job whose flag is off, a job never seen, and every job while the heartbeat alert already explains it", () => {
    expect(find(evaluateRules(facts({ jobs: [jobFact("meta-ads-sync", ["SKIPPED"], mins(999), false)] }), cfg), "job-late:meta-ads-sync")).toBeUndefined();
    expect(find(evaluateRules(facts({ jobs: [jobFact("checkStageSla", [], null)] }), cfg), "job-late:checkStageSla")).toBeUndefined();
    const a = evaluateRules(facts({ heartbeatAgeMs: 40 * 60_000, jobs: [jobFact("checkStageSla", ["OK"], mins(40))] }), cfg);
    expect(find(a, "job-late:checkStageSla")).toBeUndefined();
    expect(find(a, "heartbeat-stale")).toBeDefined();
  });
});

describe("tick-overrun", () => {
  it("raises WARN when two ticks in a row used over 80% of the lease", () => {
    const a = evaluateRules(facts({ ticks: [{ durationMs: 250_000, status: "OK" }, { durationMs: 245_000, status: "OK" }] }), cfg);
    expect(find(a, "tick-overrun")).toMatchObject({ severity: "WARN" });
  });
  it("is CRITICAL when a tick was abandoned", () => expect(find(evaluateRules(facts({ abandonedTicks: 1 }), cfg), "tick-overrun")).toMatchObject({ severity: "CRITICAL" }));
  it("is quiet for normal ticks", () => expect(find(evaluateRules(facts({ ticks: [{ durationMs: 50_000, status: "OK" }, { durationMs: 245_000, status: "OK" }] }), cfg), "tick-overrun")).toBeUndefined());
});

describe("outbox-depth", () => {
  it("raises when the queue is deep or the oldest item has waited too long", () => {
    expect(find(evaluateRules(facts({ whatsappOutbox: { depth: 80, oldestMinutes: 5 } }), cfg), "outbox-depth")).toBeDefined();
    expect(find(evaluateRules(facts({ whatsappOutbox: { depth: 3, oldestMinutes: 45 } }), cfg), "outbox-depth")).toBeDefined();
    expect(find(evaluateRules(facts({ whatsappOutbox: { depth: 3, oldestMinutes: 10 } }), cfg), "outbox-depth")).toBeUndefined();
  });
});

describe("lead-intake-failed", () => {
  it("raises on more than 5 failures in 24 h, or any failure unretried for 2 h", () => {
    expect(find(evaluateRules(facts({ leadIntake: { failed24h: 6, oldestUnretriedMinutes: 10 } }), cfg), "lead-intake-failed")).toBeDefined();
    expect(find(evaluateRules(facts({ leadIntake: { failed24h: 1, oldestUnretriedMinutes: 130 } }), cfg), "lead-intake-failed")).toBeDefined();
    expect(find(evaluateRules(facts({ leadIntake: { failed24h: 5, oldestUnretriedMinutes: 60 } }), cfg), "lead-intake-failed")).toBeUndefined();
  });
});

describe("integrations", () => {
  it("raises CRITICAL for down and WARN for degraded, and nothing for healthy, untested, mock or off", () => {
    const a = evaluateRules(facts({ integrations: [
      { key: "meta_ads", label: "Meta Ads", state: "DOWN" }, { key: "freshdesk", label: "Freshdesk", state: "DEGRADED" },
      { key: "exotel", label: "Exotel", state: "HEALTHY" }, { key: "jira", label: "Jira", state: "UNTESTED" }, { key: "clickup", label: "ClickUp", state: "MOCK" }, { key: "sms_exotel", label: "SMS", state: "FLAG_OFF" },
    ] }), cfg);
    expect(find(a, "integration-down:meta_ads")?.severity).toBe("CRITICAL");
    expect(find(a, "integration-degraded:freshdesk")?.severity).toBe("WARN");
    expect(a.filter((x) => x.key.startsWith("integration-"))).toHaveLength(2);
  });
});

describe("webhook-rejected-spike and persist failures", () => {
  it("raises when more than 20 rejections landed in the window", () => {
    expect(find(evaluateRules(facts({ rejectedWebhooks: { "webhook:leads-web": 21 } }), cfg), "webhook-rejected-spike:webhook:leads-web")).toBeDefined();
    expect(find(evaluateRules(facts({ rejectedWebhooks: { "webhook:leads-web": 20 } }), cfg), "webhook-rejected-spike:webhook:leads-web")).toBeUndefined();
  });
  it("raises jobrun-persist-failing after 3 ticks in a row", () => {
    expect(find(evaluateRules(facts({ persistFailedTicks: 3 }), cfg), "jobrun-persist-failing")).toBeDefined();
    expect(find(evaluateRules(facts({ persistFailedTicks: 2 }), cfg), "jobrun-persist-failing")).toBeUndefined();
  });
});

describe("no alert carries customer data", () => {
  it("has only keys, counts and labels in title and detail", () => {
    const all = evaluateRules(facts({ heartbeatAgeMs: 999_999_999, jobs: [jobFact("retryFailedLeads", ["FAILED", "FAILED", "FAILED"])], leadIntake: { failed24h: 9, oldestUnretriedMinutes: 300 }, whatsappOutbox: { depth: 99, oldestMinutes: 99 } }), cfg);
    const text = JSON.stringify(all);
    expect(text).not.toMatch(/@|\d{10}|postgres|Bearer/);
    for (const a of all) for (const v of Object.values(a.detail)) expect(["number", "string", "boolean"]).toContain(typeof v);
  });
});

const open = (key: string, over: Partial<OpenAlert> = {}): OpenAlert => ({ id: `id-${key}`, key, severity: "WARN", notifiedAt: null, acknowledgedAt: null, ...over });
const want = (key: string, severity: "WARN" | "CRITICAL" = "WARN"): DesiredAlert => ({ key, severity, title: `t ${key}`, detail: { n: 1 } });

describe("reconcileAlerts", () => {
  it("raises a new alert once and notifies it", () => {
    const r = reconcileAlerts([], [want("heartbeat-stale", "CRITICAL")], NOW);
    expect(r.raise.map((a) => a.key)).toEqual(["heartbeat-stale"]);
    expect(r.notify.map((a) => a.key)).toEqual(["heartbeat-stale"]);
  });
  it("keeps one open row per key: an alert that is already open is touched, not raised again", () => {
    const r = reconcileAlerts([open("heartbeat-stale", { notifiedAt: mins(10) })], [want("heartbeat-stale")], NOW);
    expect(r.raise).toEqual([]);
    expect(r.touch).toEqual(["id-heartbeat-stale"]);
    expect(r.notify).toEqual([]);
  });
  it("notifies again at most once per 24 hours while open and unacknowledged", () => {
    expect(reconcileAlerts([open("k", { notifiedAt: mins(25 * 60) })], [want("k")], NOW).notify.map((a) => a.key)).toEqual(["k"]);
    expect(reconcileAlerts([open("k", { notifiedAt: mins(23 * 60) })], [want("k")], NOW).notify).toEqual([]);
  });
  it("acknowledge suppresses re-notification", () => {
    expect(reconcileAlerts([open("k", { notifiedAt: mins(48 * 60), acknowledgedAt: mins(60) })], [want("k")], NOW).notify).toEqual([]);
  });
  it("resolves an open alert whose condition has cleared", () => {
    const r = reconcileAlerts([open("gone"), open("still")], [want("still")], NOW);
    expect(r.resolve).toEqual(["id-gone"]);
  });
  it("escalates a WARN that becomes CRITICAL and notifies it", () => {
    const r = reconcileAlerts([open("k", { severity: "WARN", notifiedAt: mins(5) })], [want("k", "CRITICAL")], NOW);
    expect(r.escalate.map((a) => a.key)).toEqual(["k"]);
    expect(r.notify.map((a) => a.key)).toEqual(["k"]);
  });
});

describe("email drafts", () => {
  it("builds a draft with no recipient, never sends, and carries no customer data", () => {
    const d = buildAlertEmailDraft({ key: "heartbeat-stale", severity: "CRITICAL", title: "The scheduler has not ticked for 40 minutes", detail: { ageMinutes: 40 }, firstRaisedAt: mins(40) }, "https://crm.example.test/settings/control-plane");
    expect(d.to).toBe("");
    expect(d.subject).toContain("CRITICAL");
    expect(d.body).toContain("40");
    expect(d.mailto.startsWith("mailto:?")).toBe(true);
    expect(d.body).toContain("https://crm.example.test/settings/control-plane");
  });
});

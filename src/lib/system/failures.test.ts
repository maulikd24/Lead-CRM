import { describe, expect, it } from "vitest";

import { MAX_RETRY_ATTEMPTS, canRetryJob, closedLoopFailureItem, groupFailures, jobFailureItem, type FailureItem } from "./failures";

const D = (m: number) => new Date(Date.UTC(2027, 3, 20, 12, 0, 0) - m * 60_000);
const item = (over: Partial<FailureItem> = {}): FailureItem => ({
  id: "i1", source: "job", group: "checkStageSla", label: "Stage SLA warnings", errorClass: "Error", reason: "Failed", firstSeen: D(60), lastSeen: D(10), count: 1, attempts: 1,
  stillFailing: true, dead: false, retry: null, dataRisk: "unknown", dataNote: "", ...over,
});

describe("groupFailures", () => {
  it("groups by source, job and error class with first seen, last seen and count", () => {
    const g = groupFailures([item({ id: "a", firstSeen: D(300), lastSeen: D(200), count: 2 }), item({ id: "b", firstSeen: D(100), lastSeen: D(5), count: 3 }), item({ id: "c", errorClass: "TypeError" })]);
    expect(g).toHaveLength(2);
    const main = g.find((x) => x.errorClass === "Error")!;
    expect(main).toMatchObject({ count: 5, firstSeen: D(300), lastSeen: D(5) });
  });
  it("is still failing when any member is", () => {
    expect(groupFailures([item({ stillFailing: false }), item({ stillFailing: true })])[0].stillFailing).toBe(true);
    expect(groupFailures([item({ stillFailing: false })])[0].stillFailing).toBe(false);
  });
  it("lists failing groups first, then the most recently seen", () => {
    const g = groupFailures([item({ group: "a", stillFailing: false, lastSeen: D(1) }), item({ group: "b", stillFailing: true, lastSeen: D(50) }), item({ group: "c", stillFailing: true, lastSeen: D(5) })]);
    expect(g.map((x) => x.group)).toEqual(["c", "b", "a"]);
  });
  it("keeps a retry only while the group is still failing and is not dead", () => {
    const retry = { kind: "job" as const, targetIds: ["r1"] };
    expect(groupFailures([item({ retry })])[0].retry).toEqual(retry);
    expect(groupFailures([item({ retry, stillFailing: false })])[0].retry).toBeNull();
    expect(groupFailures([item({ retry, dead: true })])[0].retry).toBeNull();
  });
  it("merges lead retry targets of one group", () => {
    const g = groupFailures([item({ source: "lead-intake", group: "meta", retry: { kind: "lead-intake", targetIds: ["l1"] } }), item({ source: "lead-intake", group: "meta", retry: { kind: "lead-intake", targetIds: ["l2"] } })]);
    expect(g[0].retry).toEqual({ kind: "lead-intake", targetIds: ["l1", "l2"] });
  });
  it("takes the worst data risk of the members", () => {
    expect(groupFailures([item({ dataRisk: "none" }), item({ dataRisk: "at-risk" })])[0].dataRisk).toBe("at-risk");
    expect(groupFailures([item({ dataRisk: "none" }), item({ dataRisk: "unknown" })])[0].dataRisk).toBe("unknown");
  });
});

describe("retry rules for a job", () => {
  it("allows only idempotent cron jobs, only while they are still failing, and caps the chain at 5", () => {
    expect(MAX_RETRY_ATTEMPTS).toBe(5);
    expect(canRetryJob("retryFailedLeads", 1)).toBe(true);
    expect(canRetryJob("retryFailedLeads", 5)).toBe(false);
    expect(canRetryJob("agent-nudger", 1)).toBe(false);
    expect(canRetryJob("sendDailyReportEmail", 1)).toBe(false);
    expect(canRetryJob("webhook:leads-web", 1)).toBe(false);
    expect(canRetryJob("nope", 1)).toBe(false);
  });
});

describe("jobFailureItem", () => {
  const base = { job: "meta-ads-sync", errorClass: "Http429", count: 4, firstSeen: D(90), lastSeen: D(5), latestId: "run9", latestAttempt: 1, stillFailing: true };
  it("offers a retry for an idempotent job and says no data is lost", () => {
    const i = jobFailureItem(base);
    expect(i.retry).toEqual({ kind: "job", targetIds: ["run9"] });
    expect(i.dataRisk).toBe("none");
  });
  it("offers none for a job that sends, and cannot say whether data was lost", () => {
    const i = jobFailureItem({ ...base, job: "sendDailyReportEmail" });
    expect(i.retry).toBeNull();
    expect(i.dataRisk).toBe("unknown");
  });
  it("marks a webhook failure as at risk with no retry", () => {
    const i = jobFailureItem({ ...base, job: "webhook:meta-leads", errorClass: "Http500" });
    expect(i).toMatchObject({ source: "webhook", retry: null, dataRisk: "at-risk" });
  });
  it("marks a job dead once its retry chain reaches the cap", () => {
    const i = jobFailureItem({ ...base, latestAttempt: 5 });
    expect(i.dead).toBe(true);
    expect(i.retry).toBeNull();
  });
});

describe("closed-loop conversions as a failure source", () => {
  const base = { destination: "meta_capi", label: "Meta Conversions API", dead: 2, retrying: 3, firstSeen: D(300), lastSeen: D(5), maxAttempts: 6 };
  it("shows one item per destination with counts only, a link to the Outbox, and no retry offer (retries are per event, in the Outbox)", () => {
    const i = closedLoopFailureItem(base);
    expect(i).toMatchObject({ id: "closed-loop:meta_capi", source: "closed-loop", group: "meta_capi", count: 5, attempts: 6, stillFailing: true, dead: true, retry: null, link: { href: "/closed-loop?tab=outbox&status=dead" } });
    expect(i.label).toMatch(/Meta Conversions API/);
  });
  it("says nothing is lost: the events stay in the outbox", () => {
    expect(closedLoopFailureItem(base)).toMatchObject({ dataRisk: "none" });
    expect(closedLoopFailureItem(base).dataNote).toMatch(/outbox/i);
  });
  it("only retrying rows is still failing but not dead; only dead rows is dead and not still retrying", () => {
    expect(closedLoopFailureItem({ ...base, dead: 0, retrying: 4 })).toMatchObject({ dead: false, stillFailing: true, link: { href: "/closed-loop?tab=outbox&status=failed" } });
    expect(closedLoopFailureItem({ ...base, dead: 4, retrying: 0 })).toMatchObject({ dead: true, stillFailing: true });
  });
  it("carries no customer, identifier or response text", () => {
    expect(JSON.stringify(closedLoopFailureItem(base))).not.toMatch(/@|hash|token|clientId/i);
  });
});

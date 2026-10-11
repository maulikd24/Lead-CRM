import { describe, expect, it } from "vitest";

import { approvalCandidate, bandForValue, campaignCandidate, commitmentCandidate, complaintCandidate, integrationCandidates, kycBlockerCandidate, taskCandidate, type FailureLike } from "./mappers";

const NOW = new Date("2027-05-10T05:30:00Z");
const D = 86_400_000;
const client = { id: "c1", name: "Asha Example", assignedToId: "rm1" };

describe("value band (heuristic)", () => {
  it("maps estimated opportunity value to a band, unknown when there is none", () => {
    expect(bandForValue(null)).toBe("unknown");
    expect(bandForValue(100_000)).toBe("low");
    expect(bandForValue(1_000_000)).toBe("medium");
    expect(bandForValue(5_000_000)).toBe("high");
    expect(bandForValue(50_000_000)).toBe("top");
  });
});

describe("complaint and compliance concern", () => {
  const base = { id: "i1", kind: "COMPLAINT" as const, severity: "high", occurredAt: new Date(NOW.getTime() - 2 * D), client };
  it("a complaint carries the complaint override, is AI-inferred and unconfirmed, and names no raw text", () => {
    const c = complaintCandidate(base, NOW, "medium");
    expect(c).toMatchObject({ kind: "complaint", override: "complaint", ownerUserId: "rm1", confirmed: false, sourceRef: "i1" });
    expect(c.importance).toBe(5);
    expect(JSON.stringify(c)).not.toMatch(/text/i);
  });
  it("a compliance concern is the compliance tier, with risk 5", () => {
    const c = complaintCandidate({ ...base, kind: "COMPLIANCE_CONCERN" }, NOW, "unknown");
    expect(c).toMatchObject({ kind: "complaint", subKind: "compliance_concern", override: "compliance", risk: 5 });
  });
  it("urgency climbs with age", () => {
    const young = complaintCandidate({ ...base, occurredAt: NOW }, NOW, "low");
    const old = complaintCandidate({ ...base, occurredAt: new Date(NOW.getTime() - 5 * D) }, NOW, "low");
    expect(old.urgency).toBeGreaterThan(young.urgency);
  });
});

describe("commitments, KYC blockers, tasks", () => {
  it("an overdue commitment is more urgent the longer it is overdue", () => {
    const a = commitmentCandidate({ id: "m1", dueAt: new Date(NOW.getTime() - 1 * D), occurredAt: new Date(NOW.getTime() - 5 * D), client }, NOW, "low");
    const b = commitmentCandidate({ id: "m2", dueAt: new Date(NOW.getTime() - 6 * D), occurredAt: new Date(NOW.getTime() - 9 * D), client }, NOW, "low");
    expect(b.urgency).toBeGreaterThan(a.urgency);
    expect(a.kind).toBe("overdue_commitment");
    expect(a.override).toBe("none");
  });
  it("a KYC blocker is owned by the customer's RM", () => {
    expect(kycBlockerCandidate({ id: "e1", createdAt: new Date(NOW.getTime() - 3 * D), client }, NOW, "high")).toMatchObject({ kind: "kyc_blocker", ownerUserId: "rm1", confirmed: true });
  });
  it("a task is due-based and owned by its assignee", () => {
    const t = taskCandidate({ id: "t1", title: "Send form", dueAt: new Date(NOW.getTime() - 2 * D), category: "FUNDING", assignedToId: "rm1", client: { ...client, priority: "HIGH" } }, NOW, "medium");
    expect(t).toMatchObject({ kind: "task", ownerUserId: "rm1" });
    expect(t.urgency).toBeGreaterThanOrEqual(4);
  });
});

describe("system items", () => {
  const failing = (over: Partial<FailureLike> = {}): FailureLike => ({ key: "job|meta-ads-sync|E", source: "job", group: "meta-ads-sync", label: "Meta ads sync", reason: "Failed with Error", lastSeen: new Date(NOW.getTime() - 3_600_000), count: 3, stillFailing: true, agent: false, ...over });
  it("a failing integration is an admin item without an owner, and a recovered one is not an item", () => {
    const out = integrationCandidates([failing(), failing({ key: "x", stillFailing: false })], [], NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "failed_integration", ownerUserId: null, subject: { type: "system" }, override: "none" });
  });
  it("an agent job failure is an agent_failure", () => {
    expect(integrationCandidates([failing({ agent: true, group: "agent-nudger" })], [], NOW)[0].kind).toBe("agent_failure");
  });
  it("a CRITICAL control plane alert is a critical incident that outranks the score", () => {
    const out = integrationCandidates([], [{ id: "al1", key: "heartbeat-stale", severity: "CRITICAL", title: "Scheduler stopped", firstRaisedAt: new Date(NOW.getTime() - 3_600_000) }], NOW);
    expect(out[0]).toMatchObject({ kind: "failed_integration", override: "critical_incident", sourceRef: "alert:al1" });
    const warn = integrationCandidates([], [{ id: "al2", key: "k", severity: "WARN", title: "Slow", firstRaisedAt: NOW }], NOW);
    expect(warn[0].override).toBe("none");
  });
  it("an approval waiting longer is more urgent", () => {
    const a = approvalCandidate({ id: "a1", actionType: "BULK_REASSIGN", requestedAt: NOW }, NOW);
    const b = approvalCandidate({ id: "a2", actionType: "BULK_REASSIGN", requestedAt: new Date(NOW.getTime() - 3 * D) }, NOW);
    expect(b.urgency).toBeGreaterThan(a.urgency);
    expect(a.ownerUserId).toBeNull();
  });
  it("a campaign anomaly has a campaign subject and no owner", () => {
    const c = campaignCandidate({ campaignId: "cx", campaignName: "Brand A", type: "spend_spike", severity: "high", detail: "Spend of 9,000 yesterday." }, NOW);
    expect(c).toMatchObject({ kind: "campaign_anomaly", ownerUserId: null, subject: { type: "campaign", id: "cx", label: "Brand A" } });
  });
});

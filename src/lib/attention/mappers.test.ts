import { describe, expect, it } from "vitest";

import { approvalCandidate, bandForValue, commitmentCandidate, complaintCandidate, decisionRecordCandidate, formalCommitmentCandidate, formalComplaintCandidate, integrationCandidates, kycBlockerCandidate, taskCandidate, type FailureLike } from "./mappers";

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
});


describe("Wave 2 integration: formal complaints and promises (workstream B) and shadow decisions (workstream A)", () => {
  const complaint = { id: "k1", severity: "HIGH", status: "OPEN", openedAt: new Date(NOW.getTime() - 2 * D), slaDueAt: new Date(NOW.getTime() + D), breached: false, atRisk: false, ownerId: "rm9", client };
  it("a formal complaint is a CONFIRMED complaint override item owned by the case owner; it names no title or text", () => {
    const c = formalComplaintCandidate({ ...complaint, title: "SECRET TITLE", summary: "SECRET SUMMARY" } as never, NOW, "medium");
    expect(c).toMatchObject({ kind: "complaint", subKind: "formal_complaint", override: "complaint", confirmed: true, ownerUserId: "rm9", sourceRef: "complaint:k1" });
    expect(c.importance).toBe(4);
    expect(JSON.stringify(c)).not.toMatch(/SECRET/);
  });
  it("a missed deadline is the most urgent; critical severity is top importance; with no case owner the customer's RM owns it", () => {
    const breached = formalComplaintCandidate({ ...complaint, breached: true }, NOW, "low");
    const calm = formalComplaintCandidate(complaint, NOW, "low");
    expect(breached.urgency).toBe(5);
    expect(breached.urgency).toBeGreaterThan(calm.urgency);
    expect(formalComplaintCandidate({ ...complaint, severity: "CRITICAL" }, NOW, "low").importance).toBe(5);
    expect(formalComplaintCandidate({ ...complaint, ownerId: null }, NOW, "low").ownerUserId).toBe("rm1");
    expect(breached.detail).toMatch(/deadline has passed/i);
  });
  it("an overdue, person-confirmed promise is a confirmed item (the insight-derived one is not), and urgency climbs with lateness", () => {
    const a = formalCommitmentCandidate({ id: "m1", dueAt: new Date(NOW.getTime() - 1 * D), ownerId: "rm9", client }, NOW, "low");
    const b = formalCommitmentCandidate({ id: "m2", dueAt: new Date(NOW.getTime() - 6 * D), ownerId: null, client }, NOW, "low");
    expect(a).toMatchObject({ kind: "overdue_commitment", subKind: "formal_commitment", confirmed: true, ownerUserId: "rm9", sourceRef: "commitment:m1" });
    expect(b.urgency).toBeGreaterThan(a.urgency);
    expect(b.ownerUserId).toBe("rm1");
  });
  const rec = { id: "d1", clientId: "c1", clientName: "Asha Example", ownerId: "rm1", action: "Call", programme: "PMS / AIF opportunity", topic: "PMS", priority: "High", priorityScore: 82, timing: "Today", confidence: "high", createdAt: NOW };
  it("a decision record becomes an opportunity with the decision's own priority, timing and confidence; its sourceRef is the decision", () => {
    const c = decisionRecordCandidate(rec, "high");
    expect(c).toMatchObject({ kind: "customer_opportunity", subKind: "decision", sourceRef: "decision:d1", ownerUserId: "rm1", confirmed: true, confidence: "high", href: "/clients/c1?sheet=decision" });
    expect(c.importance).toBe(4);
    expect(c.urgency).toBe(4); // Today
    expect(decisionRecordCandidate({ ...rec, timing: "Later", priority: "Medium", priorityScore: 40 }, "low")).toMatchObject({ importance: 3, urgency: 2 });
  });
  it("a low-confidence decision (an AI reading nobody confirmed, a question for a person) is unconfirmed: it can only be down-ranked", () => {
    expect(decisionRecordCandidate({ ...rec, confidence: "low", action: "Review" }, "low")).toMatchObject({ confirmed: false, confidence: "low" });
  });
  it("the title and detail are built from enums and the customer's name, never from the decision's reason or evidence", () => {
    const c = decisionRecordCandidate({ ...rec, reason: "SECRET REASON", evidence: [{ text: "SECRET EVIDENCE" }] } as never, "low");
    expect(c.title).toContain("Asha Example");
    expect(c.detail).toMatch(/Decision Engine/);
    expect(JSON.stringify(c)).not.toMatch(/SECRET/);
  });
});

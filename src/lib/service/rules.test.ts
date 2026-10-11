import { describe, expect, it } from "vitest";

import { ComplaintSeverity, ComplaintStatus, CommitmentStatus } from "@/generated/prisma/client";

import {
  ACK_HOURS,
  COMMITMENT_STATUSES,
  COMPLAINT_SEVERITIES,
  COMPLAINT_STATUSES,
  REOPEN_WINDOW_DAYS,
  SLA_HOURS,
  ackState,
  commitmentState,
  complaintTransition,
  commitmentTransition,
  isOverdueCommitment,
  slaDueAt,
  slaState,
  type ComplaintLike,
  type CommitmentLike,
} from "./rules";

const NOW = new Date("2027-06-30T10:00:00Z");
const h = (n: number) => n * 3_600_000;
const ago = (hours: number) => new Date(NOW.getTime() - h(hours));
const ahead = (hours: number) => new Date(NOW.getTime() + h(hours));

const complaint = (over: Partial<ComplaintLike> = {}): ComplaintLike => ({
  status: "OPEN",
  severity: "MEDIUM",
  ownerId: "rm1",
  openedAt: ago(10),
  acknowledgedAt: null,
  slaDueAt: ahead(62),
  resolvedAt: null,
  closedAt: null,
  reopenedCount: 0,
  ...over,
});

describe("vocabulary matches the schema", () => {
  it("severities, statuses", () => {
    expect([...COMPLAINT_SEVERITIES].sort()).toEqual(Object.values(ComplaintSeverity).sort());
    expect([...COMPLAINT_STATUSES].sort()).toEqual(Object.values(ComplaintStatus).sort());
    expect([...COMMITMENT_STATUSES].sort()).toEqual(Object.values(CommitmentStatus).sort());
  });
});

describe("the SLA clock", () => {
  it("is derived from severity: the higher the severity the shorter the clock", () => {
    expect(SLA_HOURS.CRITICAL).toBeLessThan(SLA_HOURS.HIGH);
    expect(SLA_HOURS.HIGH).toBeLessThan(SLA_HOURS.MEDIUM);
    expect(SLA_HOURS.MEDIUM).toBeLessThan(SLA_HOURS.LOW);
    expect(slaDueAt(NOW, "HIGH").getTime()).toBe(NOW.getTime() + h(SLA_HOURS.HIGH));
  });
  it("states: ok, at risk in the last quarter, breached after the deadline; met and missed once resolved", () => {
    const opened = ago(10);
    expect(slaState(complaint({ openedAt: opened, slaDueAt: ahead(62) }), NOW)).toBe("ok");
    expect(slaState(complaint({ openedAt: ago(60), slaDueAt: ahead(12) }), NOW)).toBe("at_risk");
    expect(slaState(complaint({ openedAt: ago(80), slaDueAt: ago(8) }), NOW)).toBe("breached");
    expect(slaState(complaint({ status: "RESOLVED", resolvedAt: ago(5), slaDueAt: ahead(10) }), NOW)).toBe("met");
    expect(slaState(complaint({ status: "RESOLVED", resolvedAt: ago(1), slaDueAt: ago(8) }), NOW)).toBe("missed");
    expect(slaState(complaint({ status: "CLOSED", resolvedAt: ago(5), slaDueAt: ahead(10) }), NOW)).toBe("met");
  });
  it("acknowledgement has its own, shorter clock", () => {
    expect(ackState(complaint({ openedAt: ago(1) }), NOW)).toBe("pending");
    expect(ackState(complaint({ openedAt: ago(ACK_HOURS + 1) }), NOW)).toBe("overdue");
    expect(ackState(complaint({ openedAt: ago(100), acknowledgedAt: ago(90) }), NOW)).toBe("done");
  });
});

describe("complaint lifecycle: severity, status, owner, SLA, resolution, reopen", () => {
  const actor = "u1";
  it("start work moves OPEN to IN_PROGRESS, sets acknowledgement once, and needs an owner", () => {
    const r = complaintTransition(complaint(), { type: "start", actorId: actor }, NOW);
    expect(r).toMatchObject({ ok: true, patch: { status: "IN_PROGRESS", acknowledgedAt: NOW } });
    expect(complaintTransition(complaint({ ownerId: null }), { type: "start", actorId: actor }, NOW)).toMatchObject({ ok: false, code: "OWNER_REQUIRED" });
    const again = complaintTransition(complaint({ status: "REOPENED", acknowledgedAt: ago(100) }), { type: "start", actorId: actor }, NOW);
    expect(again).toMatchObject({ ok: true });
    expect((again as unknown as { patch: Record<string, unknown> }).patch.acknowledgedAt).toBeUndefined(); // acknowledged once
  });
  it("acknowledge alone stamps the time without changing status", () => {
    expect(complaintTransition(complaint(), { type: "acknowledge", actorId: actor }, NOW)).toMatchObject({ ok: true, patch: { acknowledgedAt: NOW } });
    expect(complaintTransition(complaint({ acknowledgedAt: ago(1) }), { type: "acknowledge", actorId: actor }, NOW)).toMatchObject({ ok: false, code: "ALREADY" });
  });
  it("resolve needs a resolution code and a note, from OPEN, IN_PROGRESS or REOPENED only", () => {
    expect(complaintTransition(complaint({ status: "IN_PROGRESS" }), { type: "resolve", actorId: actor, resolutionCode: "", resolution: "x" }, NOW)).toMatchObject({ ok: false, code: "RESOLUTION_REQUIRED" });
    expect(complaintTransition(complaint({ status: "IN_PROGRESS" }), { type: "resolve", actorId: actor, resolutionCode: "REFUNDED", resolution: "  " }, NOW)).toMatchObject({ ok: false, code: "RESOLUTION_REQUIRED" });
    const ok = complaintTransition(complaint({ status: "IN_PROGRESS" }), { type: "resolve", actorId: actor, resolutionCode: "EXPLAINED", resolution: "Explained the charge and refunded 200" }, NOW);
    expect(ok).toMatchObject({ ok: true, patch: { status: "RESOLVED", resolvedAt: NOW, resolutionCode: "EXPLAINED" } });
    expect(complaintTransition(complaint({ status: "CLOSED" }), { type: "resolve", actorId: actor, resolutionCode: "X", resolution: "y" }, NOW)).toMatchObject({ ok: false, code: "BAD_STATE" });
  });
  it("close only from RESOLVED", () => {
    expect(complaintTransition(complaint({ status: "RESOLVED", resolvedAt: ago(1) }), { type: "close", actorId: actor }, NOW)).toMatchObject({ ok: true, patch: { status: "CLOSED", closedAt: NOW } });
    expect(complaintTransition(complaint({ status: "OPEN" }), { type: "close", actorId: actor }, NOW)).toMatchObject({ ok: false, code: "BAD_STATE" });
  });
  it("reopen needs a reason, only from RESOLVED or CLOSED and only inside the reopen window, counts, and restarts the SLA clock", () => {
    const resolved = complaint({ status: "RESOLVED", resolvedAt: ago(24), severity: "HIGH" });
    expect(complaintTransition(resolved, { type: "reopen", actorId: actor, reason: " " }, NOW)).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    const r = complaintTransition(resolved, { type: "reopen", actorId: actor, reason: "Refund never arrived" }, NOW);
    expect(r).toMatchObject({ ok: true, patch: { status: "REOPENED", reopenedCount: 1, lastReopenedAt: NOW, resolvedAt: null, closedAt: null } });
    expect((r as unknown as { patch: { slaDueAt: Date } }).patch.slaDueAt.getTime()).toBe(NOW.getTime() + h(SLA_HOURS.HIGH));
    const old = complaint({ status: "CLOSED", resolvedAt: ago(24 * (REOPEN_WINDOW_DAYS + 1)), closedAt: ago(24 * (REOPEN_WINDOW_DAYS + 1)) });
    expect(complaintTransition(old, { type: "reopen", actorId: actor, reason: "again" }, NOW)).toMatchObject({ ok: false, code: "REOPEN_WINDOW_PASSED" });
    expect(complaintTransition(complaint({ status: "OPEN" }), { type: "reopen", actorId: actor, reason: "x" }, NOW)).toMatchObject({ ok: false, code: "BAD_STATE" });
  });
  it("a reopened complaint never gets a longer clock than before: second reopen counts again", () => {
    const again = complaintTransition(complaint({ status: "RESOLVED", resolvedAt: ago(2), reopenedCount: 1 }), { type: "reopen", actorId: actor, reason: "still broken" }, NOW);
    expect(again).toMatchObject({ ok: true, patch: { reopenedCount: 2 } });
  });
  it("changing severity re-bases the SLA on the open time but never moves a deadline earlier than now", () => {
    const up = complaintTransition(complaint({ openedAt: ago(10), severity: "LOW", slaDueAt: ahead(110) }), { type: "set_severity", actorId: actor, severity: "CRITICAL" }, NOW);
    expect(up).toMatchObject({ ok: true, patch: { severity: "CRITICAL" } });
    const due = (up as unknown as { patch: { slaDueAt: Date } }).patch.slaDueAt;
    expect(due.getTime()).toBeGreaterThanOrEqual(NOW.getTime());
    expect(complaintTransition(complaint({ status: "CLOSED" }), { type: "set_severity", actorId: actor, severity: "HIGH" }, NOW)).toMatchObject({ ok: false, code: "BAD_STATE" });
  });
  it("assigning an owner is allowed while the case is live", () => {
    expect(complaintTransition(complaint(), { type: "assign", actorId: actor, ownerId: "rm2" }, NOW)).toMatchObject({ ok: true, patch: { ownerId: "rm2" } });
    expect(complaintTransition(complaint(), { type: "assign", actorId: actor, ownerId: "" }, NOW)).toMatchObject({ ok: false, code: "OWNER_REQUIRED" });
  });
  it("every transition needs a named person", () => {
    expect(complaintTransition(complaint(), { type: "start", actorId: "" }, NOW)).toMatchObject({ ok: false, code: "ACTOR_REQUIRED" });
    expect(complaintTransition(complaint(), { type: "start", actorId: "system" }, NOW)).toMatchObject({ ok: false, code: "ACTOR_REQUIRED" });
  });
});

describe("commitments: who promised what to whom by when", () => {
  const c = (over: Partial<CommitmentLike> = {}): CommitmentLike => ({ status: "OPEN", dueAt: ahead(48), keptAt: null, ...over });
  it("overdue is derived: open and past due; kept, broken and cancelled are never overdue", () => {
    expect(isOverdueCommitment(c({ dueAt: ago(1) }), NOW)).toBe(true);
    expect(isOverdueCommitment(c({ dueAt: ahead(1) }), NOW)).toBe(false);
    for (const status of ["KEPT", "BROKEN", "CANCELLED"] as const) expect(isOverdueCommitment(c({ status, dueAt: ago(100) }), NOW)).toBe(false);
  });
  it("states: open, due soon inside 24 hours, overdue, kept, kept late, broken, cancelled", () => {
    expect(commitmentState(c(), NOW)).toBe("open");
    expect(commitmentState(c({ dueAt: ahead(5) }), NOW)).toBe("due_soon");
    expect(commitmentState(c({ dueAt: ago(5) }), NOW)).toBe("overdue");
    expect(commitmentState(c({ status: "KEPT", keptAt: ago(10), dueAt: ahead(1) }), NOW)).toBe("kept");
    expect(commitmentState(c({ status: "KEPT", keptAt: ago(1), dueAt: ago(10) }), NOW)).toBe("kept_late");
    expect(commitmentState(c({ status: "BROKEN" }), NOW)).toBe("broken");
    expect(commitmentState(c({ status: "CANCELLED" }), NOW)).toBe("cancelled");
  });
  it("keep, break and cancel are human actions; break and cancel need a note", () => {
    expect(commitmentTransition(c(), { type: "keep", actorId: "u1" }, NOW)).toMatchObject({ ok: true, patch: { status: "KEPT", keptAt: NOW } });
    expect(commitmentTransition(c(), { type: "break", actorId: "u1", note: "" }, NOW)).toMatchObject({ ok: false, code: "NOTE_REQUIRED" });
    expect(commitmentTransition(c(), { type: "break", actorId: "u1", note: "Could not reach the back office" }, NOW)).toMatchObject({ ok: true, patch: { status: "BROKEN", brokenAt: NOW } });
    expect(commitmentTransition(c(), { type: "cancel", actorId: "u1", note: "Customer no longer needs it" }, NOW)).toMatchObject({ ok: true, patch: { status: "CANCELLED" } });
    expect(commitmentTransition(c(), { type: "keep", actorId: "" }, NOW)).toMatchObject({ ok: false, code: "ACTOR_REQUIRED" });
  });
  it("a broken commitment can still be kept late; kept or cancelled ones are final", () => {
    expect(commitmentTransition(c({ status: "BROKEN" }), { type: "keep", actorId: "u1" }, NOW)).toMatchObject({ ok: true, patch: { status: "KEPT" } });
    expect(commitmentTransition(c({ status: "KEPT" }), { type: "break", actorId: "u1", note: "x" }, NOW)).toMatchObject({ ok: false, code: "BAD_STATE" });
    expect(commitmentTransition(c({ status: "CANCELLED" }), { type: "keep", actorId: "u1" }, NOW)).toMatchObject({ ok: false, code: "BAD_STATE" });
  });
});

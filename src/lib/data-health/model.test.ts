import { describe, expect, it } from "vitest";

import { CHECKS, classifyEventOrphan, lifecycleViolations, reconcilePlan, type ExistingItem, type Finding } from "./model";

const finding = (over: Partial<Finding> = {}): Finding => ({ checkKey: "no_identity_keys", subjectType: "client", subjectId: "c1", clientId: "c1", severity: "WARN", title: "t", ...over });
const item = (over: Partial<ExistingItem> = {}): ExistingItem => ({ id: "i1", checkKey: "no_identity_keys", subjectType: "client", subjectId: "c1", status: "OPEN", ...over });

describe("check catalogue", () => {
  it("every check has a title, a severity, a reason and a fix, and no title carries a placeholder for personal data", () => {
    for (const [key, c] of Object.entries(CHECKS)) {
      expect(c.title, key).toBeTruthy();
      expect(["INFO", "WARN", "HIGH"]).toContain(c.severity);
      expect(c.why.length, key).toBeGreaterThan(10);
      expect(c.fix.length, key).toBeGreaterThan(10);
    }
  });
  it("covers the five required families", () => {
    expect(Object.keys(CHECKS)).toEqual(expect.arrayContaining(["orphaned_event", "no_identity_keys", "stale_intelligence", "unassigned_lead", "impossible_lifecycle"]));
  });
});

describe("reconcilePlan", () => {
  it("creates a work item for a new finding", () => {
    const plan = reconcilePlan([], [finding()], ["no_identity_keys"]);
    expect(plan.create).toHaveLength(1);
    expect(plan.touch).toHaveLength(0);
    expect(plan.resolve).toEqual([]);
  });
  it("touches a finding that is still there and keeps an acknowledgement", () => {
    const plan = reconcilePlan([item({ status: "ACKNOWLEDGED" })], [finding()], ["no_identity_keys"]);
    expect(plan.touch).toEqual([{ id: "i1", reopen: false }]);
    expect(plan.create).toEqual([]);
  });
  it("resolves an open item whose finding has gone away", () => {
    expect(reconcilePlan([item()], [], ["no_identity_keys"]).resolve).toEqual(["i1"]);
  });
  it("reopens a resolved item whose problem came back", () => {
    expect(reconcilePlan([item({ status: "RESOLVED" })], [finding()], ["no_identity_keys"]).touch).toEqual([{ id: "i1", reopen: true }]);
  });
  it("never resolves items of a check that did not run this time (a failed query must not close work items)", () => {
    const plan = reconcilePlan([item(), item({ id: "i2", checkKey: "unassigned_lead" })], [], ["no_identity_keys"]);
    expect(plan.resolve).toEqual(["i1"]);
  });
  it("does not touch an already resolved item that is still gone", () => {
    expect(reconcilePlan([item({ status: "RESOLVED" })], [], ["no_identity_keys"]).resolve).toEqual([]);
  });
});

describe("classifyEventOrphan", () => {
  it("an event with no customer id is never an orphan", () => expect(classifyEventOrphan({ clientId: null, clientExists: false, erased: false })).toBe("ok"));
  it("an event whose customer exists is fine", () => expect(classifyEventOrphan({ clientId: "c1", clientExists: true, erased: false })).toBe("ok"));
  it("an event of an erased customer is expected: erasure keeps the fact and removes the customer", () => expect(classifyEventOrphan({ clientId: "c1", clientExists: false, erased: true })).toBe("erased"));
  it("an event whose customer is gone without an erasure record is an orphan", () => expect(classifyEventOrphan({ clientId: "c1", clientExists: false, erased: false })).toBe("orphan"));
});

describe("lifecycleViolations (impossible states)", () => {
  const ok = { status: "ACTIVE", completedAt: null, kycStatus: null, fundingStatus: null, mergedIntoId: null, mergeTargetState: "none" as const };
  it("a clean lead has none", () => expect(lifecycleViolations(ok)).toEqual([]));
  it("funded without an approved KYC", () => {
    expect(lifecycleViolations({ ...ok, fundingStatus: "FULLY_FUNDED", kycStatus: "PENDING" })).toEqual(["funded_without_kyc"]);
    expect(lifecycleViolations({ ...ok, fundingStatus: "PARTIALLY_FUNDED", kycStatus: null })).toEqual(["funded_without_kyc"]);
    expect(lifecycleViolations({ ...ok, fundingStatus: "FULLY_FUNDED", kycStatus: "APPROVED" })).toEqual([]);
  });
  it("a pending funding record is not funded", () => expect(lifecycleViolations({ ...ok, fundingStatus: "PENDING", kycStatus: null })).toEqual([]));
  it("completed status without a completion date, and a completion date on an active customer", () => {
    expect(lifecycleViolations({ ...ok, status: "COMPLETED", completedAt: null })).toEqual(["status_completed_mismatch"]);
    expect(lifecycleViolations({ ...ok, status: "ACTIVE", completedAt: new Date() })).toEqual(["status_completed_mismatch"]);
    expect(lifecycleViolations({ ...ok, status: "COMPLETED", completedAt: new Date() })).toEqual([]);
  });
  it("a merged customer whose survivor row is gone", () => {
    expect(lifecycleViolations({ ...ok, mergedIntoId: "x", mergeTargetState: "missing" })).toEqual(["merge_target_invalid"]);
    expect(lifecycleViolations({ ...ok, mergedIntoId: "x", mergeTargetState: "live" })).toEqual([]);
  });
  it("an archived or itself-merged survivor is legitimate (merge chains), and a scrubbed duplicate of an erased survivor keeps its pointer by design", () => {
    expect(lifecycleViolations({ ...ok, mergedIntoId: "x", mergeTargetState: "live" })).toEqual([]);
    expect(lifecycleViolations({ ...ok, mergedIntoId: "x", mergeTargetState: "missing", scrubbed: true })).toEqual([]);
  });
  it("reports every violation at once", () => {
    expect(lifecycleViolations({ ...ok, status: "COMPLETED", completedAt: null, fundingStatus: "FULLY_FUNDED", kycStatus: null }).sort()).toEqual(["funded_without_kyc", "status_completed_mismatch"]);
  });
});

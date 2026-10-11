import { describe, expect, it } from "vitest";

import { applyApproved, decideRecommendation, type DecisionDeps } from "@/lib/autopilot/decisions";
import { createFakeActionProvider, guarded } from "@/lib/autopilot/actions";
import type { Recommendation } from "@/lib/autopilot/recommendations";

import { definitionOf } from "../definitions";
import { createApprovalService } from "../service";
import { createAutopilotActionAdapter, toCanonicalAutopilotAction, type ActionRow } from "./autopilot-action";

const NOW = new Date("2027-07-01T10:00:00Z");
const RUN = "7f9c24e8-3b0a-5c5e-9d77-3b2f5f6d0a11";
const ADMIN = { id: "a1", role: "ADMIN" } as const;
const MKT = { id: "mk1", role: "MARKETING" } as const;
const MKT2 = { id: "mk2", role: "MARKETING" } as const;

type Mutable = { row: ActionRow };
const baseRow = (over: Partial<ActionRow> = {}): ActionRow => ({
  id: "BD1:m1", ruleKey: "BD1", category: "Bidding", severity: "high", issue: "Cost per funded customer is over target", evidence: ["₹5,200 per funded customer", "target ₹4,000"],
  actionKind: "pause_campaign", actionSummary: "Pause Meta - Demat open", impactAmount: 12000, impactText: "Could save about ₹12,000 a month", confidence: "high", appliable: true,
  status: "PENDING", decidedById: null, decidedAt: null, decisionNote: null, appliedAt: null, lastError: null, firstSeenAt: new Date("2027-06-28T10:00:00Z"), expiresAt: new Date("2027-07-05T10:00:00Z"),
  correlationId: RUN, ruleAuthorId: null, ...over,
});

/** The legacy path (decisions.ts) over an in-memory row, the adapter over the same row, and the canonical service over the adapter. */
function world(initial: Partial<ActionRow> = {}, opts: { secondApprover?: boolean; applyEnabled?: boolean } = {}) {
  const m: Mutable = { row: baseRow(initial) };
  const fake = createFakeActionProvider();
  const events: string[] = [];
  const asRec = (): Recommendation => ({
    id: m.row.id, ruleKey: m.row.ruleKey, category: m.row.category as never, severity: m.row.severity as never, issue: m.row.issue, evidence: m.row.evidence,
    action: { kind: m.row.actionKind as never, targetIds: ["m1"], summary: m.row.actionSummary, params: {} }, impact: { amount: m.row.impactAmount, text: m.row.impactText },
    confidence: m.row.confidence as never, appliable: m.row.appliable, status: m.row.status as never, correlationId: m.row.correlationId,
  });
  const legacy: DecisionDeps = {
    getRec: async () => asRec(),
    recordDecision: async (d) => { if (m.row.status !== "PENDING") return false; m.row = { ...m.row, status: d.decision === "APPROVED" ? "APPROVED" : "DENIED", decidedById: d.actorId, decidedAt: NOW, decisionNote: d.note }; return true; },
    claimApply: async () => { if (m.row.status !== "APPROVED") return false; m.row = { ...m.row, status: "APPLYING" }; return true; },
    markApplied: async (_i, _u, r) => { m.row = { ...m.row, status: r.ok ? "APPLIED" : "FAILED", appliedAt: r.ok ? NOW : null, lastError: r.ok ? null : (r.error ?? null) }; },
    provider: guarded(fake, { applyEnabled: opts.applyEnabled ?? true }),
    emit: async (k) => { events.push(k); },
  };
  const adapter = createAutopilotActionAdapter({
    loadAwaiting: async () => (m.row.status === "PENDING" ? [m.row] : []), loadRow: async (id) => (id === m.row.id ? m.row : null),
    requireSecondApprover: async () => opts.secondApprover ?? false,
    decide: (i) => decideRecommendation(legacy, i),
    expire: async () => { m.row = { ...m.row, status: "EXPIRED" }; },
  });
  const audit: unknown[] = [];
  const svc = createApprovalService({ adapters: { "autopilot-action": adapter }, now: () => NOW, audit: async (e) => { audit.push(e); }, writeThrough: () => false, mirror: async () => undefined, consentGate: () => undefined });
  return { m, fake, events, adapter, svc, legacy, audit };
}

describe("the canonical definition", () => {
  it("is a read-through adapter, L4 ad spend, four-eyes available, expiry on the row, approved by ADMIN and MARKETING only", () => {
    const d = definitionOf("autopilot-action");
    expect(d).toMatchObject({ adapter: "read-through", fourEyes: true, expiry: { kind: "row" }, approverRoles: ["ADMIN", "MARKETING"], autoApprove: "never", requesterRoles: "system" });
    expect(d.autonomy).toMatchObject({ level: "L4", adSpend: true });
    expect(d.requiredEvidence).toEqual(["issue", "impact"]);
    expect(d.writeThroughFlag).toBe("APPROVALS_WT_AUTOPILOT_ACTION");
  });
});

describe("view: every legacy status maps to a canonical state", () => {
  it("maps, and an undecided proposal past its expiry reads as expired", () => {
    const st = (over: Partial<ActionRow>, now = NOW) => toCanonicalAutopilotAction(baseRow(over), now, false).state;
    expect(st({ status: "PENDING" })).toBe("requested");
    expect(st({ status: "PENDING", expiresAt: new Date(NOW.getTime() - 1) })).toBe("expired");
    expect(st({ status: "APPROVED" })).toBe("approved");
    expect(st({ status: "APPLYING" })).toBe("approved");
    expect(st({ status: "APPLIED" })).toBe("executed");
    expect(st({ status: "DENIED" })).toBe("rejected");
    expect(st({ status: "FAILED" })).toBe("failed");
    expect(st({ status: "EXPIRED" })).toBe("expired");
    expect(st({ status: "UNDONE" })).toBe("cancelled");
  });
  it("carries the evidence an approver needs, the autonomy level and the audit run's correlation id; never a customer", () => {
    const v = toCanonicalAutopilotAction(baseRow(), NOW, false);
    expect(v.evidence.map((e) => e.key)).toEqual(expect.arrayContaining(["issue", "impact", "action", "confidence"]));
    expect(v).toMatchObject({ kind: "autopilot-action", autonomy: "L4", correlationId: RUN, clientId: null, requestedBy: null, fourEyesAuthorId: null });
    expect(v.subject.href).toBe("/autopilot?tab=actions");
  });
  it("names the rule's author as the four-eyes person only when Settings turn it on", () => {
    const row = baseRow({ ruleKey: "RULE_r1", ruleAuthorId: "mk1" });
    expect(toCanonicalAutopilotAction(row, NOW, false).fourEyesAuthorId).toBeNull();
    expect(toCanonicalAutopilotAction(row, NOW, true).fourEyesAuthorId).toBe("mk1");
  });
});

describe("who can see and decide", () => {
  it("ADMIN and MARKETING see the proposal; everyone else sees nothing (not found and not visible look the same)", async () => {
    const w = world();
    expect((await w.adapter.listAwaiting(MKT, NOW, 10)).map((a) => a.ref)).toEqual(["autopilot-action:BD1:m1"]);
    expect(await w.adapter.listAwaiting(ADMIN, NOW, 10)).toHaveLength(1);
    for (const role of ["RM", "MANAGER", "FINANCE", "DEALER", "PARTNER"] as const) {
      expect(await w.adapter.listAwaiting({ id: "x", role }, NOW, 10), role).toEqual([]);
      expect(await w.adapter.get("BD1:m1", { id: "x", role }, NOW), role).toBeNull();
      expect(await w.svc.decide({ id: "x", role }, "autopilot-action:BD1:m1", "approve", {}), role).toMatchObject({ ok: false, code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
    }
    expect(w.m.row.status).toBe("PENDING");
  });
  it("requests are made by the system: nobody has 'requested by me' items", async () => {
    expect(await world().adapter.listRequestedBy(MKT, NOW, 10)).toEqual([]);
  });
});

describe("approve through the canonical service calls the legacy path and nothing else", () => {
  it("approve: the row is approved, the audit row is written, the ad account is untouched and a separate human apply is still needed", async () => {
    const w = world();
    const r = await w.svc.decide(MKT, "autopilot-action:BD1:m1", "approve", {});
    expect(r).toMatchObject({ ok: true, state: "approved" });
    expect(w.m.row).toMatchObject({ status: "APPROVED", decidedById: "mk1" });
    expect(w.events).toEqual(["approved"]);
    expect(w.fake.log).toEqual([]);
    expect(w.audit).toHaveLength(1);
    expect(w.audit[0]).toMatchObject({ entity: "Approval", entityId: "autopilot-action:BD1:m1", action: "approval_approved" });
    // the second explicit human act
    expect(await applyApproved(w.legacy, { recId: "BD1:m1", actorId: "mk1" })).toEqual({ ok: true });
    expect(w.fake.log).toEqual(["apply pause_campaign m1"]);
    expect(w.m.row.status).toBe("APPLIED");
  });
  it("reject needs a reason, records it and applies nothing", async () => {
    const w = world();
    expect(await w.svc.decide(MKT, "autopilot-action:BD1:m1", "reject", {})).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    expect(w.m.row.status).toBe("PENDING");
    const r = await w.svc.decide(MKT, "autopilot-action:BD1:m1", "reject", { reason: "We already paused this on Friday", params: { reasonCode: "already_handled" } });
    expect(r).toMatchObject({ ok: true, state: "rejected" });
    expect(w.m.row).toMatchObject({ status: "DENIED", decisionNote: "We already paused this on Friday" });
    expect(w.fake.log).toEqual([]);
  });
  it("a rejection from the inbox (reason text only) is recorded as 'other' with the words given", async () => {
    const w = world();
    expect(await w.svc.decide(MKT, "autopilot-action:BD1:m1", "reject", { reason: "Not now, campaign is under review" })).toMatchObject({ ok: true, state: "rejected" });
    expect(w.m.row.status).toBe("DENIED");
  });
  it("a reason code the legacy path does not know is treated as 'other' with the words given, never an error", async () => {
    const w = world();
    expect(await w.svc.decide(MKT, "autopilot-action:BD1:m1", "reject", { reason: "Campaign is under review", params: { reasonCode: "made_up" } })).toMatchObject({ ok: true, state: "rejected" });
  });
  it("a double approve (two tabs) decides once; the loser is told it is already decided", async () => {
    const w = world();
    const [a, b] = await Promise.all([w.svc.decide(MKT, "autopilot-action:BD1:m1", "approve", {}), w.svc.decide(ADMIN, "autopilot-action:BD1:m1", "approve", {})]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(w.events).toEqual(["approved"]);
  });
  it("an expired proposal cannot be approved and is recorded as expired", async () => {
    const w = world({ expiresAt: new Date(NOW.getTime() - 60_000) });
    expect(await w.svc.decide(MKT, "autopilot-action:BD1:m1", "approve", {})).toMatchObject({ ok: false, code: "EXPIRED" });
    expect(w.m.row.status).toBe("EXPIRED");
    expect(w.fake.log).toEqual([]);
  });
  it("a decided proposal cannot be decided again", async () => {
    const w = world({ status: "APPLIED" });
    expect(await w.svc.decide(MKT, "autopilot-action:BD1:m1", "approve", {})).toMatchObject({ ok: false });
  });
});

describe("four eyes, optional per Settings", () => {
  it("off: the author of the rule may approve what their own rule proposed", async () => {
    const w = world({ ruleKey: "RULE_r1", ruleAuthorId: "mk1" }, { secondApprover: false });
    expect(await w.svc.decide(MKT, "autopilot-action:BD1:m1", "approve", {})).toMatchObject({ ok: true });
  });
  it("on: the author of the rule may not approve it; a colleague may", async () => {
    const w = world({ ruleKey: "RULE_r1", ruleAuthorId: "mk1" }, { secondApprover: true });
    expect(await w.svc.decide(MKT, "autopilot-action:BD1:m1", "approve", {})).toMatchObject({ ok: false, code: "SELF_APPROVAL" });
    expect(w.m.row.status).toBe("PENDING");
    expect(await w.svc.decide(MKT2, "autopilot-action:BD1:m1", "approve", {})).toMatchObject({ ok: true });
  });
  it("on: a built-in proposal (no human author) is approved by whoever is allowed", async () => {
    const w = world({}, { secondApprover: true });
    expect(await w.svc.decide(MKT, "autopilot-action:BD1:m1", "approve", {})).toMatchObject({ ok: true });
  });
});

describe("human only", () => {
  it("an agent or system id cannot decide", async () => {
    const w = world();
    expect(await w.svc.decide({ id: "agent:ad_autopilot", role: "ADMIN" }, "autopilot-action:BD1:m1", "approve", {})).toMatchObject({ ok: false, code: "NOT_HUMAN" });
    expect(w.m.row.status).toBe("PENDING");
  });
});

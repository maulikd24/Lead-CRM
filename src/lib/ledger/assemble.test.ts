import { describe, expect, it } from "vitest";

import { assembleLedger, type AssembleContext } from "./assemble";
import { DAY, HOUR, T0, adRecommendationApplied, aiDraftApprovedThenSent, at, complaintThenReview, decision, decisionSuppressed, ev } from "./fixtures.testkit";
import { emptyBundle } from "./bundle";

const ctx = (o: Partial<AssembleContext> = {}): AssembleContext => ({ now: at(10 * DAY), canSeeDecisions: true, approvalVisible: () => true, ...o });
const kind = (entries: ReturnType<typeof assembleLedger>, k: string) => entries.filter((e) => e.kind === k);

describe("chain 1: complaint resolved, then a review is scheduled", () => {
  it("shows the complaint as one certain entry with its raise and its resolution", () => {
    const [service] = kind(assembleLedger(complaintThenReview(), ctx()), "service");
    expect(service.action.label).toMatch(/complaint resolved/i);
    expect(service.confidence).toBe("certain");
    expect(service.trigger?.label).toMatch(/complaint raised/i);
    expect(service.result?.label).toMatch(/resolved/i);
    expect(service.executedBy?.label).toBe("Riya Menon");
    expect(service.sources.map((s) => s.table)).toEqual(expect.arrayContaining(["Complaint", "CustomerEvent"]));
  });

  it("links the review task as follow-on by subject and time window, labelled INFERRED with a lower score", () => {
    const entries = assembleLedger(complaintThenReview(), ctx());
    const [service] = kind(entries, "service");
    const [task] = kind(entries, "task");
    const follow = service.followOn.find((s) => s.source.table === "Task");
    expect(follow).toBeDefined();
    expect(follow?.confidence).toBe("inferred");
    expect(follow?.score).toBeLessThan(1);
    expect(follow?.inferredBecause).toMatch(/same customer/i);
    // The task's own story rests on that guess, so the TASK entry is inferred; the complaint's own story is not.
    expect(task.confidence).toBe("inferred");
    expect(task.trigger?.label).toMatch(/possibly/i);
    expect(task.inferredLinks).toHaveLength(1);
    expect(task.score).toBeLessThan(1);
    expect(service.confidence).toBe("certain");
  });

  it("does not link a task made long after the window", () => {
    const b = complaintThenReview();
    b.tasks[0].createdAt = at(2 * DAY + 5 * DAY);
    const entries = assembleLedger(b, ctx());
    expect(kind(entries, "service")[0].followOn.some((s) => s.source.table === "Task")).toBe(false);
    expect(kind(entries, "task")[0].confidence).toBe("certain");
    expect(kind(entries, "task")[0].trigger?.label ?? "").not.toMatch(/possibly/i);
  });

  it("does not link a task made BEFORE the resolution", () => {
    const b = complaintThenReview();
    b.tasks[0].createdAt = at(DAY);
    expect(kind(assembleLedger(b, ctx()), "service")[0].followOn.some((s) => s.source.table === "Task")).toBe(false);
  });

  it("is CERTAIN when the task carries the complaint id", () => {
    const entries = assembleLedger(complaintThenReview({ explicitTask: true }), ctx());
    const follow = kind(entries, "service")[0].followOn.find((s) => s.source.table === "Task");
    expect(follow?.confidence).toBe("certain");
    expect(kind(entries, "task")[0].confidence).toBe("certain");
    expect(kind(entries, "task")[0].inferredLinks).toEqual([]);
  });
});

describe("chain 2: an AI draft is approved, then sent", () => {
  const entries = () => assembleLedger(aiDraftApprovedThenSent(), ctx());

  it("is ONE entry: the draft, its approval, the message and its events are not listed again, and the customer's reply is not an action of ours", () => {
    const all = entries();
    expect(all.filter((e) => e.kind !== "decision")).toHaveLength(1);
    expect(kind(all, "message")).toHaveLength(1);
    expect(kind(all, "draft")).toHaveLength(0);
  });

  it("answers the ledger fields: trigger, decision with engine version, evidence, who initiated, who executed", () => {
    const [m] = kind(entries(), "message");
    expect(m.action.label).toMatch(/AI-drafted/i);
    expect(m.trigger?.label).toMatch(/decision engine/i);
    expect(m.decision).toMatchObject({ engineVersion: "v2.0.0-shadow", result: "RECOMMEND", programme: "kyc" });
    expect(m.evidence.length).toBeGreaterThan(0);
    expect(m.evidence[0]).toMatchObject({ kind: "fact" });
    expect(m.initiatedBy).toMatchObject({ type: "agent", id: "wa_nudger" });
    expect(m.executedBy).toMatchObject({ type: "user", id: "rm1", label: "Riya Menon" });
  });

  it("shows AI involvement from the agent registry with the level in force", () => {
    const [m] = kind(entries(), "message");
    expect(m.ai).toMatchObject({ agentKey: "wa_nudger", actionType: "draft_customer_message", level: 3 });
    expect(m.ai?.levelLabel).toMatch(/L3/);
    expect(m.ai?.approvalPolicy).toBe("always");
  });

  it("uses the stored autonomy level when a row exists, never above the agent's maximum", () => {
    const b = aiDraftApprovedThenSent();
    b.autonomy = new Map([["wa_nudger:draft_customer_message", 5]]);
    expect(kind(assembleLedger(b, ctx()), "message")[0].ai?.level).toBe(4);
  });

  it("names who approved it and when; the canonical mirror row is not a second approval", () => {
    const [m] = kind(entries(), "message");
    expect(m.approval).toMatchObject({ state: "executed", by: { id: "rm1", name: "Riya Menon" } });
    expect(m.approval.source?.table).toBe("AgentProposal");
  });

  it("shows the result and the follow-on (the reply, the decision outcome) as certain steps", () => {
    const [m] = kind(entries(), "message");
    expect(m.result?.label).toMatch(/delivered/i);
    const follow = m.followOn.map((s) => s.title.toLowerCase()).join("|");
    expect(follow).toMatch(/reply|response/);
    expect(m.followOn.every((s) => s.confidence === "certain" || s.inferredBecause)).toBe(true);
  });

  it("ties the two model runs to the draft by customer and time, labelled inferred, WITHOUT lowering the entry (telemetry only)", () => {
    const [m] = kind(entries(), "message");
    expect(m.ai?.runs).toMatchObject({ count: 2, confidence: "inferred" });
    expect(m.inferredLinks.some((l) => l.role === "supporting")).toBe(true);
    expect(m.confidence).toBe("certain");
    const runStep = m.chain.find((s) => s.source.table === "AgentRun");
    expect(runStep?.confidence).toBe("inferred");
    expect(runStep?.inferredBecause).toMatch(/same customer/i);
  });

  it("links every record with a source link and the chain is ordered by time within each phase", () => {
    const [m] = kind(entries(), "message");
    const tables = new Set(m.sources.map((s) => s.table));
    for (const t of ["DecisionRecord", "AgentProposal", "Message", "CustomerEvent", "AuditLog", "AgentRun"]) expect(tables.has(t)).toBe(true);
    const order = ["trigger", "decision", "approval", "execution", "result", "follow_on"];
    const phases = m.chain.map((s) => order.indexOf(s.phase));
    expect(phases).toEqual([...phases].sort((a, b) => a - b));
  });

  it("hides the decision and its entry from a viewer who may not see decisions, but keeps the message entry", () => {
    const all = assembleLedger(aiDraftApprovedThenSent(), ctx({ canSeeDecisions: false }));
    expect(kind(all, "decision")).toHaveLength(0);
    const [m] = kind(all, "message");
    expect(m.decision).toBeNull();
    expect(m.chain.some((s) => s.source.table === "DecisionRecord")).toBe(false);
    expect(m.sources.some((s) => s.table === "DecisionRecord")).toBe(false);
    expect(m.evidence).toEqual([]);
  });
});

describe("chain 3: a decision is suppressed", () => {
  it("is a decision entry that says nothing was sent, why, and under which engine version", () => {
    const [d] = kind(assembleLedger(decisionSuppressed(), ctx()), "decision");
    expect(d.action.label).toMatch(/no action/i);
    expect(d.decision?.suppressions[0]).toMatchObject({ rule: "open_complaint", effect: "block" });
    expect(d.decision?.engineVersion).toBe("v2.0.0-shadow");
    expect(d.result?.label).toMatch(/held back|nothing was sent/i);
    expect(d.approval.state).toBe("not_required");
    expect(d.executedBy).toBeNull();
    expect(d.confidence).toBe("certain");
  });

  it("carries the consent decision the engine recorded", () => {
    const [d] = kind(assembleLedger(decisionSuppressed(), ctx()), "decision");
    expect(d.decision?.consent).toMatch(/consent ok/i);
  });

  it("an unactioned RECOMMEND shadow decision is not an action and is not listed; an ABSTAIN is", () => {
    const b = emptyBundle(C_ID);
    b.decisions.push(decision({ id: "dA", createdAt: at(0) }), decision({ id: "dB", createdAt: at(HOUR), result: "ABSTAIN", abstainReason: "data_stale" }));
    const all = assembleLedger(b, ctx());
    expect(all.map((e) => e.id)).toEqual(["DecisionRecord:dB"]);
    expect(all[0].action.label).toMatch(/abstained/i);
    expect(all[0].decision?.abstainReason).toBe("data_stale");
  });
});

const C_ID = "client_1";

describe("chain 4: an ad recommendation is applied", () => {
  it("joins the recommended, approved and applied events and the approval on the shared correlation id", () => {
    const all = assembleLedger(adRecommendationApplied(), ctx());
    expect(all).toHaveLength(1);
    const [e] = all;
    expect(e.kind).toBe("campaign");
    expect(e.action.label).toMatch(/applied/i);
    expect(e.trigger?.label).toMatch(/recommended/i);
    expect(e.trigger?.actor).toMatchObject({ type: "agent", id: "autopilot" });
    expect(e.approval).toMatchObject({ state: "executed", by: { id: "mkt1" } });
    expect(e.correlationIds).toContain("9a3c1f00-0000-4000-8000-0000000000aa");
    expect(e.confidence).toBe("certain");
    expect(e.chain.map((s) => s.phase)).toEqual(expect.arrayContaining(["trigger", "approval", "execution"]));
    expect(e.inferredLinks).toEqual([]);
  });

  it("joins by causation id alone when the correlation id differs", () => {
    const b = adRecommendationApplied();
    b.events[2].correlationId = "other-corr";
    b.approvals = [];
    const [e] = assembleLedger(b, ctx());
    expect(e.chain.filter((s) => s.source.table === "CustomerEvent")).toHaveLength(3);
  });
});

describe("correlation ids", () => {
  it("never joins on the customer-wide flow id: two unrelated actions for one customer stay two entries", () => {
    const b = aiDraftApprovedThenSent();
    b.tasks.push({ id: "tskX", clientId: C_ID, assignedToId: "rm1", title: "Call about SIP", dueAt: at(9 * DAY), status: "PENDING", category: "FOLLOW_UP", source: "manual", createdAt: at(5 * DAY), updatedAt: at(5 * DAY) });
    b.events.push(ev({ eventType: "lead.contacted", occurredAt: at(5 * DAY) }));
    // a second, unrelated message with its own event: both events carry the customer's flow id
    b.messages.push({ id: "msg2", clientId: C_ID, channel: "whatsapp", provider: "openwa", direction: "OUTBOUND", templateId: null, status: "SENT", origin: "crm", senderUserId: "rm1", createdAt: at(6 * DAY), sentAt: at(6 * DAY) });
    b.events.push(ev({ eventType: "whatsapp.message.sent", occurredAt: at(6 * DAY), actorType: "user", actorId: "rm1", metadata: { ref: { table: "Message", id: "msg2" } } }));
    const all = assembleLedger(b, ctx());
    expect(kind(all, "task")).toHaveLength(1);
    expect(kind(all, "message")).toHaveLength(2);
    expect(kind(all, "task")[0].chain.some((s) => s.source.table === "Message")).toBe(false);
  });
});

describe("heuristic: an RM message sent shortly after a recommendation, with no id between them", () => {
  it("is linked as inferred, with the reason in words", () => {
    const b = emptyBundle(C_ID);
    b.users = new Map([["rm1", "Riya Menon"]]);
    b.decisions.push(decision({ id: "dH", createdAt: at(0), status: "ACCEPTED" }));
    b.messages.push({ id: "mH", clientId: C_ID, channel: "whatsapp", provider: "openwa", direction: "OUTBOUND", templateId: null, status: "SENT", origin: "crm", senderUserId: "rm1", createdAt: at(3 * HOUR), sentAt: at(3 * HOUR) });
    const all = assembleLedger(b, ctx());
    const m = kind(all, "message")[0];
    expect(m.confidence).toBe("inferred");
    expect(m.trigger?.label).toMatch(/possibly/i);
    expect(m.inferredLinks[0].because).toMatch(/same customer/i);
    expect(m.approval.state).toBe("not_required");
    expect(m.ai).toBeNull();
  });
});

describe("approvals of other kinds", () => {
  it("a native approval is an approval entry; a viewer who may not see the kind gets no entry", () => {
    const b = emptyBundle(C_ID);
    b.users = new Map([["mgr1", "Manish Kapoor"], ["adm1", "Anil Desai"]]);
    b.approvals.push({ id: "apS", actionType: "STAGE_OVERRIDE", entity: "Client", entityId: C_ID, status: "APPROVED", requestedById: "mgr1", requestedAt: at(0), decidedById: "adm1", decidedAt: at(HOUR), decisionNote: null, appliedAt: at(HOUR), correlationId: null, causationId: null, autonomyLevel: "L4", mirror: null });
    const seen = assembleLedger(b, ctx());
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: "approval" });
    expect(seen[0].approval).toMatchObject({ state: "executed", by: { id: "adm1" } });
    expect(seen[0].initiatedBy).toMatchObject({ type: "user", id: "mgr1" });
    expect(assembleLedger(b, ctx({ approvalVisible: () => false }))).toHaveLength(0);
  });
});

describe("consent and stage actions", () => {
  it("a consent change is a consent entry with the purpose and the channel", () => {
    const b = emptyBundle(C_ID);
    b.users = new Map([["rm1", "Riya Menon"]]);
    b.consents.push({ id: "co1", clientId: C_ID, purpose: "MARKETING_COMMS", channel: "WHATSAPP", status: "WITHDRAWN", source: "whatsapp_keyword", capturedAt: at(0), capturedById: null });
    const [e] = assembleLedger(b, ctx());
    expect(e.kind).toBe("consent");
    expect(e.action.label).toMatch(/withdrawn/i);
    expect(e.action.label).toMatch(/marketing/i);
    expect(e.result?.tone).toBe("warning");
  });

  it("a stage change is a stage entry; the audit row of the same person at the same moment is attached as supporting evidence, inferred", () => {
    const b = emptyBundle(C_ID);
    b.users = new Map([["rm1", "Riya Menon"]]);
    b.stages.push({ id: "st1", clientId: C_ID, fromStage: "New", toStage: "KYC", changedById: "rm1", changedAt: at(0), reason: null });
    b.audits.push({ id: "au9", userId: "rm1", entity: "Client", entityId: C_ID, action: "stage_changed", timestamp: at(0.5), newValue: {} });
    const [e] = assembleLedger(b, ctx());
    expect(e.kind).toBe("stage");
    expect(e.chain.some((s) => s.source.table === "AuditLog" && s.confidence === "inferred")).toBe(true);
    expect(e.confidence).toBe("certain");
  });
});

describe("ordering and paging", () => {
  it("newest first, kind filter applied", () => {
    const b = complaintThenReview();
    const all = assembleLedger(b, ctx());
    const times = all.map((e) => e.at);
    expect(times).toEqual([...times].sort().reverse());
  });
  it("has a stable entry id", () => {
    const a = assembleLedger(aiDraftApprovedThenSent(), ctx()).map((e) => e.id);
    const b = assembleLedger(aiDraftApprovedThenSent(), ctx()).map((e) => e.id);
    expect(a).toEqual(b);
    expect(a).toContain("Message:msg1");
  });
});

describe("no raw personal data", () => {
  it("an entry never carries a message body, phone, email or PAN, even if a row had one", () => {
    const b = aiDraftApprovedThenSent();
    (b.messages[0] as unknown as Record<string, unknown>).body = "Call me on +919812345678 or a@b.co PAN ABCDE1234F";
    (b.proposals[0] as unknown as Record<string, unknown>).body = "secret draft text";
    (b.events[1].metadata as Record<string, unknown>).phone = "+919812345678";
    const json = JSON.stringify(assembleLedger(b, ctx()));
    expect(json).not.toMatch(/9812345678|a@b\.co|ABCDE1234F|secret draft text/);
  });
});

void T0;

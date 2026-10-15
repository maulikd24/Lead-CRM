import { describe, expect, it, vi } from "vitest";

import type { Role } from "@/generated/prisma/client";

import type { ApprovalAdapter, ApprovalKind, CanonicalApproval, DecideInput, LegacyOutcome } from "./contract";
import { createApprovalService, type ServiceDeps } from "./service";

const NOW = new Date("2027-04-20T10:00:00Z");
const actor = (role: Role, id = `u-${role}`) => ({ id, role });

function item(kind: ApprovalKind, id: string, over: Partial<CanonicalApproval> = {}): CanonicalApproval {
  return {
    ref: `${kind}:${id}`, kind, id, subject: { type: "t", id: "s1", label: "A thing", href: "/x" }, state: "requested", legacyState: "OPEN", summary: "s",
    requestedBy: { id: "maker", name: "Maker" }, requestedAt: new Date("2027-04-20T08:00:00Z"), approver: null, decidedAt: null, decisionReason: null, expiresAt: null,
    evidence: [{ key: "draft", label: "Draft", value: "hello" }, { key: "reason", label: "Why", value: "because" }], correlationId: `approval:${kind}:${id}`, causationId: null,
    autonomy: "L4", fourEyesAuthorId: null, clientId: "c1", ...over,
  };
}

/** A fake adapter with a real compare-and-set, so a race has exactly one winner. */
function fakeAdapter(kind: ApprovalKind, rows: CanonicalApproval[], over: Partial<ApprovalAdapter> = {}) {
  const store = new Map(rows.map((r) => [r.id, { ...r }]));
  const calls: DecideInput[] = [];
  const adapter: ApprovalAdapter = {
    kind,
    listAwaiting: async () => [...store.values()].filter((r) => r.state === "requested"),
    listRequestedBy: async (a) => [...store.values()].filter((r) => r.requestedBy?.id === a.id),
    get: async (id) => store.get(id) ?? null,
    decide: async (input): Promise<LegacyOutcome> => {
      calls.push(input);
      const row = store.get(input.subjectId);
      if (!row || row.state !== "requested") return { ok: false, code: "ALREADY_DECIDED", error: "already decided" };
      await Promise.resolve(); // yield so a concurrent caller can interleave
      const cur = store.get(input.subjectId)!;
      if (cur.state !== "requested") return { ok: false, code: "ALREADY_DECIDED", error: "already decided" };
      cur.state = input.decision === "approve" ? "executed" : "rejected";
      return { ok: true };
    },
    expire: vi.fn(async () => undefined),
    ...over,
  };
  return { adapter, store, calls };
}

function build(adapters: ApprovalAdapter[], over: Partial<ServiceDeps> = {}) {
  const audit = vi.fn(async () => undefined);
  const mirror = vi.fn(async () => undefined);
  const deps: ServiceDeps = {
    adapters: Object.fromEntries(adapters.map((a) => [a.kind, a])),
    now: () => NOW,
    audit,
    writeThrough: () => false,
    mirror,
    consentGate: () => undefined,
    ...over,
  };
  return { svc: createApprovalService(deps), audit, mirror };
}

describe("listing: who sees what", () => {
  it("an approver gets only the kinds they may approve, and the other adapters are never asked", async () => {
    const agent = fakeAdapter("agent-proposal", [item("agent-proposal", "p1")]);
    const stmt = fakeAdapter("referral-statement", [item("referral-statement", "s1")]);
    const spy = vi.spyOn(stmt.adapter, "listAwaiting");
    const { svc } = build([agent.adapter, stmt.adapter]);
    const rm = await svc.listFor(actor("RM"), { tab: "awaiting" });
    expect(rm.items.map((i) => i.kind)).toEqual(["agent-proposal"]);
    expect(spy).not.toHaveBeenCalled();
    const fin = await svc.listFor(actor("FINANCE"), { tab: "awaiting" });
    expect(fin.items.map((i) => i.kind)).toEqual(["referral-statement"]);
  });

  it("MARKETING sees only marketing kinds, even if an adapter would return more", async () => {
    const social = fakeAdapter("social-post", [item("social-post", "x1", { requestedBy: { id: "someone", name: null } })]);
    const agent = fakeAdapter("agent-proposal", [item("agent-proposal", "p1")]);
    const { svc } = build([social.adapter, agent.adapter]);
    const out = await svc.listFor(actor("MARKETING"), { tab: "awaiting" });
    expect(out.items.map((i) => i.kind)).toEqual(["social-post"]);
  });

  it("a role with no approval role sees nothing", async () => {
    const agent = fakeAdapter("agent-proposal", [item("agent-proposal", "p1")]);
    const { svc } = build([agent.adapter]);
    for (const role of ["DEALER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "TEAM_MANAGER"] as const) expect((await svc.listFor(actor(role), { tab: "awaiting" })).items, role).toEqual([]);
  });

  it("four-eyes: your own request is not awaiting you, but it is in your requests", async () => {
    const run = fakeAdapter("partner-tax-rule", [item("partner-tax-rule", "t1", { requestedBy: { id: "u-FINANCE", name: "Me" }, fourEyesAuthorId: "u-FINANCE" }), item("partner-tax-rule", "t2", { fourEyesAuthorId: "maker" })]);
    const { svc } = build([run.adapter]);
    const awaiting = await svc.listFor(actor("FINANCE"), { tab: "awaiting" });
    expect(awaiting.items.map((i) => i.id)).toEqual(["t2"]);
    const mine = await svc.listFor(actor("FINANCE"), { tab: "mine" });
    expect(mine.items.map((i) => i.id)).toEqual(["t1"]);
  });

  it("a requester who cannot approve sees only their own requests", async () => {
    const stage = fakeAdapter("stage-override", [item("stage-override", "o1", { requestedBy: { id: "u-MANAGER", name: null } }), item("stage-override", "o2")]);
    const { svc } = build([stage.adapter]);
    expect((await svc.listFor(actor("MANAGER"), { tab: "awaiting" })).items).toEqual([]);
    expect((await svc.listFor(actor("MANAGER"), { tab: "mine" })).items.map((i) => i.id)).toEqual(["o1"]);
  });

  it("filters by kind, counts per kind, and orders the longest-waiting first", async () => {
    const a = fakeAdapter("agent-proposal", [item("agent-proposal", "p1", { requestedAt: new Date("2027-04-20T09:00:00Z") })]);
    const m = fakeAdapter("merge-suggestion", [item("merge-suggestion", "m1", { requestedAt: new Date("2027-04-19T09:00:00Z"), evidence: [{ key: "reasons", label: "r", value: "x" }, { key: "score", label: "s", value: "9" }] })]);
    const { svc } = build([a.adapter, m.adapter]);
    const all = await svc.listFor(actor("RM"), { tab: "awaiting" });
    expect(all.items.map((i) => i.kind)).toEqual(["merge-suggestion", "agent-proposal"]);
    expect(all.counts).toEqual({ "agent-proposal": 1, "merge-suggestion": 1 });
    expect((await svc.listFor(actor("RM"), { tab: "awaiting", kind: "agent-proposal" })).items.map((i) => i.kind)).toEqual(["agent-proposal"]);
  });

  it("each item carries what the screen may offer", async () => {
    const a = fakeAdapter("social-post", [item("social-post", "x1", { evidence: [{ key: "post", label: "p", value: "v" }, { key: "compliance", label: "c", value: "ok" }] })]);
    const { svc } = build([a.adapter]);
    const [it1] = (await svc.listFor(actor("MARKETING"), { tab: "awaiting" })).items;
    expect(it1.actions).toMatchObject({ canApprove: true, canReject: true, inlineApprove: true, needs: ["confirmed"], blocked: null });
  });
});

describe("deciding", () => {
  const A = (over: Partial<CanonicalApproval> = {}) => fakeAdapter("agent-proposal", [item("agent-proposal", "p1", over)]);

  it("approve calls the legacy path once and reports the new state", async () => {
    const a = A();
    const { svc, audit } = build([a.adapter]);
    const r = await svc.decide(actor("RM"), "agent-proposal:p1", "approve", {});
    expect(r).toMatchObject({ ok: true, state: "executed" });
    expect(a.calls).toHaveLength(1);
    expect(a.calls[0]).toMatchObject({ subjectId: "p1", decision: "approve", actor: { id: "u-RM" } });
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("refuses someone who is not an approver of this kind, without touching the legacy path", async () => {
    const a = A();
    const { svc } = build([a.adapter]);
    for (const role of ["MARKETING", "FINANCE", "MANAGER", "DEALER"] as const) {
      const r = await svc.decide(actor(role), "agent-proposal:p1", "approve", {});
      expect(r, role).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    expect(a.calls).toHaveLength(0);
  });

  it("an item the person cannot see looks exactly like one that does not exist", async () => {
    const a = fakeAdapter("agent-proposal", [], {});
    const { svc } = build([a.adapter]);
    expect(await svc.decide(actor("RM"), "agent-proposal:missing", "approve", {})).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await svc.decide(actor("RM"), "nonsense", "approve", {})).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await svc.decide(actor("RM"), "autopilot-action:z", "approve", {})).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("four-eyes: the maker cannot approve their own request, even if the legacy path would let it through", async () => {
    const f = fakeAdapter("partner-tax-rule", [item("partner-tax-rule", "t1", { fourEyesAuthorId: "u-FINANCE", requestedBy: { id: "u-FINANCE", name: null } })]);
    const { svc, audit } = build([f.adapter]);
    expect(await svc.decide(actor("FINANCE"), "partner-tax-rule:t1", "approve", {})).toMatchObject({ ok: false, code: "SELF_APPROVAL" });
    expect(f.calls).toHaveLength(0);
    expect(audit).not.toHaveBeenCalled();
  });

  it("a reject needs a reason; an approve does not", async () => {
    const a = A();
    const { svc } = build([a.adapter]);
    expect(await svc.decide(actor("RM"), "agent-proposal:p1", "reject", { reason: "   " })).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    expect(a.calls).toHaveLength(0);
    expect(await svc.decide(actor("RM"), "agent-proposal:p1", "reject", { reason: "Wrong tone" })).toMatchObject({ ok: true, state: "rejected" });
    expect(a.calls[0].reason).toBe("Wrong tone");
  });

  it("missing evidence blocks an approval but not a rejection", async () => {
    const a = A({ evidence: [] });
    const { svc } = build([a.adapter]);
    expect(await svc.decide(actor("RM"), "agent-proposal:p1", "approve", {})).toMatchObject({ ok: false, code: "EVIDENCE_MISSING" });
    expect(await svc.decide(actor("RM"), "agent-proposal:p1", "reject", { reason: "no evidence" })).toMatchObject({ ok: true });
  });

  it("a kind with no reject path says so", async () => {
    const s = fakeAdapter("referral-statement", [item("referral-statement", "s1", { evidence: [{ key: "total", label: "t", value: "1" }, { key: "lines", label: "l", value: "1" }] })]);
    const { svc } = build([s.adapter]);
    expect(await svc.decide(actor("FINANCE"), "referral-statement:s1", "reject", { reason: "no" })).toMatchObject({ ok: false, code: "UNSUPPORTED" });
  });

  it("an approval that needs a tick or a choice does not go through without it", async () => {
    const p = fakeAdapter("social-post", [item("social-post", "x1", { evidence: [{ key: "post", label: "p", value: "v" }, { key: "compliance", label: "c", value: "ok" }] })]);
    const { svc } = build([p.adapter]);
    expect(await svc.decide(actor("MARKETING"), "social-post:x1", "approve", {})).toMatchObject({ ok: false, code: "NEEDS_INPUT" });
    expect(await svc.decide(actor("MARKETING"), "social-post:x1", "approve", { params: { confirmed: true } })).toMatchObject({ ok: true });
  });

  it("an irreversible approval is not done in place", async () => {
    const m = fakeAdapter("merge-suggestion", [item("merge-suggestion", "m1", { evidence: [{ key: "reasons", label: "r", value: "x" }, { key: "score", label: "s", value: "9" }] })]);
    const { svc } = build([m.adapter]);
    expect(await svc.decide(actor("MANAGER"), "merge-suggestion:m1", "approve", { params: { confirmed: true, survivorId: "c1" } })).toMatchObject({ ok: false, code: "NEEDS_INPUT" });
    expect(m.calls).toHaveLength(0);
    expect(await svc.decide(actor("MANAGER"), "merge-suggestion:m1", "reject", { reason: "Different people" })).toMatchObject({ ok: true, state: "rejected" });
  });

  it("an item that is already decided cannot be decided again", async () => {
    const a = A({ state: "rejected" });
    const { svc, audit } = build([a.adapter]);
    expect(await svc.decide(actor("RM"), "agent-proposal:p1", "approve", {})).toMatchObject({ ok: false, code: "ALREADY_DECIDED" });
    expect(a.calls).toHaveLength(0);
    expect(audit).not.toHaveBeenCalled();
  });

  it("an expired request cannot be approved or rejected; the expiry is recorded the way the legacy path records it", async () => {
    const a = A({ expiresAt: new Date(NOW.getTime() - 1000), state: "expired" });
    const { svc } = build([a.adapter]);
    for (const decision of ["approve", "reject"] as const) {
      expect(await svc.decide(actor("RM"), "agent-proposal:p1", decision, { reason: "x" })).toMatchObject({ ok: false, code: "EXPIRED" });
    }
    expect(a.calls).toHaveLength(0);
    expect(a.adapter.expire).toHaveBeenCalledWith("p1", NOW);
  });

  it("a consent precondition stops a customer-facing approval, only when enforcement hands back a gate", async () => {
    const a = A();
    const gate = vi.fn(async () => ({ allowed: false, reason: "no consent" }));
    const { svc } = build([a.adapter], { consentGate: () => gate });
    expect(await svc.decide(actor("RM"), "agent-proposal:p1", "approve", {})).toMatchObject({ ok: false, code: "PRECONDITION" });
    expect(gate).toHaveBeenCalledWith("c1");
    expect(a.calls).toHaveLength(0);
    // rejecting never needs consent
    expect(await svc.decide(actor("RM"), "agent-proposal:p1", "reject", { reason: "no" })).toMatchObject({ ok: true });
    // enforcement off: no gate, no check
    const b = A();
    expect(await build([b.adapter]).svc.decide(actor("RM"), "agent-proposal:p1", "approve", {})).toMatchObject({ ok: true });
  });

  it("only a signed-in person decides: an agent or system id is refused", async () => {
    const a = A();
    const { svc } = build([a.adapter]);
    for (const id of ["", "agent:wa_nudger", "system", "system:cron"]) expect(await svc.decide({ id, role: "ADMIN" }, "agent-proposal:p1", "approve", {}), id).toMatchObject({ ok: false, code: "NOT_HUMAN" });
    expect(a.calls).toHaveLength(0);
  });

  it("a legacy failure passes through untouched, with no audit row and no mirror", async () => {
    const a = fakeAdapter("agent-proposal", [item("agent-proposal", "p1")], { decide: async () => ({ ok: false, code: "BLOCKED", error: "Message blocked", reasons: ["x"] }) });
    const { svc, audit, mirror } = build([a.adapter], { writeThrough: () => true });
    expect(await svc.decide(actor("RM"), "agent-proposal:p1", "approve", {})).toEqual({ ok: false, code: "BLOCKED", error: "Message blocked", reasons: ["x"] });
    expect(audit).not.toHaveBeenCalled();
    expect(mirror).not.toHaveBeenCalled();
  });

  it("writes one audit entry with identity, reason and the correlation chain", async () => {
    const a = A({ causationId: "evt-1" });
    const { svc, audit } = build([a.adapter]);
    await svc.decide(actor("RM", "rm-7"), "agent-proposal:p1", "reject", { reason: "Too pushy" });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ userId: "rm-7", entity: "Approval", entityId: "agent-proposal:p1", action: "approval_rejected", reason: "Too pushy", newValue: expect.objectContaining({ kind: "agent-proposal", state: "rejected", correlationId: "approval:agent-proposal:p1", causationId: "evt-1", autonomy: "L4" }) }));
  });

  it("write-through is per kind and off by default; a failing mirror or audit never changes the legacy outcome", async () => {
    const a = A();
    const off = build([a.adapter]);
    await off.svc.decide(actor("RM"), "agent-proposal:p1", "approve", {});
    expect(off.mirror).not.toHaveBeenCalled();

    const b = A();
    const on = build([b.adapter], { writeThrough: (k) => k === "agent-proposal", mirror: vi.fn(async () => { throw new Error("db down"); }), audit: vi.fn(async () => { throw new Error("audit down"); }) });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await on.svc.decide(actor("RM"), "agent-proposal:p1", "approve", {})).toMatchObject({ ok: true, state: "executed" });
    spy.mockRestore();

    const c = A();
    const ok = build([c.adapter], { writeThrough: () => true });
    await ok.svc.decide(actor("RM", "rm-1"), "agent-proposal:p1", "approve", { reason: "good" });
    expect(ok.mirror).toHaveBeenCalledWith(expect.objectContaining({ kind: "agent-proposal", id: "p1", decision: "approve", actorId: "rm-1", reason: "good", correlationId: "approval:agent-proposal:p1", autonomy: "L4" }));
  });

  it("double-approve race: exactly one winner, one send, one audit", async () => {
    const a = A();
    const { svc, audit } = build([a.adapter]);
    const [r1, r2] = await Promise.all([svc.decide(actor("RM", "rm-1"), "agent-proposal:p1", "approve", {}), svc.decide(actor("ADMIN", "adm"), "agent-proposal:p1", "approve", {})]);
    const oks = [r1, r2].filter((r) => r.ok);
    expect(oks).toHaveLength(1);
    expect([r1, r2].find((r) => !r.ok)).toMatchObject({ ok: false, code: "ALREADY_DECIDED" });
    expect(audit).toHaveBeenCalledTimes(1);
  });
});

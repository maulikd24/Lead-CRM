import { describe, expect, it, vi } from "vitest";

import { createApprovalService } from "../service";
import { NATIVE_KINDS, type NativeKind } from "../native";
import { createApprovalRequestAdapter, toCanonicalRequest, type RequestRow } from "./approval-request";

const NOW = new Date("2027-04-20T09:00:00Z");
const admin = { id: "adm", role: "ADMIN" } as const;
const finance = { id: "fin", role: "FINANCE" } as const;
const maker = { id: "fin0", role: "FINANCE" } as const;
const manager = { id: "mgr", role: "MANAGER" } as const;
const rm = { id: "rm", role: "RM" } as const;

const row = (kind: NativeKind, over: Partial<RequestRow> = {}): RequestRow => ({
  id: "r1", actionType: NATIVE_KINDS[kind], entity: "X", entityId: "e1", status: "PENDING", payload: {}, reason: "Because", requestedById: "fin0", requestedByName: "Fiona", requestedAt: new Date("2027-04-19T09:00:00Z"),
  decidedById: null, decidedAt: null, decisionNote: null, expiresAt: null, appliedAt: null, correlationId: null, causationId: null, autonomyLevel: null, ...over,
});
const PAYOUT_FACTS = { period: "1 Mar 2027 to 31 Mar 2027", payouts: 4, totalNet: "₹1,20,000.00" };

function setup(kind: NativeKind, rows: RequestRow[], over: { decide?: ReturnType<typeof vi.fn> } = {}) {
  const decide = over.decide ?? vi.fn(async () => undefined);
  const adapter = createApprovalRequestAdapter({
    kind, decide: decide as never,
    loadAwaiting: async () => rows.filter((r) => r.status === "PENDING"), loadRequestedBy: async (_k, id) => rows.filter((r) => r.requestedById === id),
    loadRow: async (id) => rows.find((r) => r.id === id) ?? null, loadFacts: async () => PAYOUT_FACTS,
  });
  const svc = createApprovalService({ adapters: { [kind]: adapter }, now: () => NOW, audit: async () => undefined, writeThrough: () => false, mirror: async () => undefined, consentGate: () => undefined });
  return { adapter, svc, decide };
}

describe("approval request view (native kinds)", () => {
  it("maps statuses: pending, approved (executed once applied), rejected, cancelled, expired", () => {
    const st = (over: Partial<RequestRow>) => toCanonicalRequest("payout-run", row("payout-run", over), NOW, PAYOUT_FACTS).state;
    expect(st({})).toBe("requested");
    expect(st({ status: "APPROVED" })).toBe("approved");
    expect(st({ status: "APPROVED", appliedAt: NOW })).toBe("executed");
    expect(st({ status: "REJECTED" })).toBe("rejected");
    expect(st({ status: "CANCELLED" })).toBe("cancelled");
    expect(st({ status: "EXPIRED" })).toBe("expired");
    expect(st({ expiresAt: new Date(NOW.getTime() - 1) })).toBe("expired");
  });

  it("carries identity, reason, expiry and the correlation chain (a stable default when none was given)", () => {
    const v = toCanonicalRequest("payout-run", row("payout-run", { status: "APPROVED", decidedById: "adm", decidedAt: NOW, decisionNote: "Checked the holds", correlationId: "corr-1", causationId: "evt-1", autonomyLevel: "L4" }), NOW, PAYOUT_FACTS);
    expect(v).toMatchObject({ requestedBy: { id: "fin0", name: "Fiona" }, approver: { id: "adm", name: null }, decisionReason: "Checked the holds", correlationId: "corr-1", causationId: "evt-1", autonomy: "L4", fourEyesAuthorId: "fin0", ref: "payout-run:r1" });
    expect(toCanonicalRequest("payout-run", row("payout-run"), NOW, PAYOUT_FACTS)).toMatchObject({ correlationId: "approval:payout-run:r1", causationId: null, autonomy: "L4" });
  });

  it("each kind explains itself without ids or personal details", () => {
    const payout = toCanonicalRequest("payout-run", row("payout-run", { entity: "PayoutRun", payload: { payoutRunId: "run1" } }), NOW, PAYOUT_FACTS);
    expect(payout.evidence.find((e) => e.key === "period")?.value).toBe("1 Mar 2027 to 31 Mar 2027");
    expect(payout.subject).toMatchObject({ type: "Payout run", href: "/earnings/runs/run1" });
    const adj = toCanonicalRequest("commission-adjustment", row("commission-adjustment", { payload: { partnerProfileId: "p", payoutId: "po", amount: -2500.5, reason: "Overpaid" } }), NOW, null);
    expect(adj.evidence.find((e) => e.key === "amount")?.value).toBe("-₹2,500.50");
    expect(adj.evidence.find((e) => e.key === "reason")?.value).toBe("Overpaid");
    const erase = toCanonicalRequest("erasure-request", row("erasure-request", { payload: { erasureRequestId: "er1" }, reason: "Customer asked in writing" }), NOW, null);
    expect(erase.evidence.find((e) => e.key === "subject")?.value).toBe("Customer asked in writing");
    expect(erase.subject.href).toBe("/settings/data-privacy");
    const stage = toCanonicalRequest("stage-override", row("stage-override", { payload: { clientId: "c9", toStageId: "s2", reason: "Entered wrongly" } }), NOW, null);
    expect(stage.subject).toMatchObject({ type: "Customer", href: "/clients/c9" });
    expect(stage.evidence.find((e) => e.key === "reason")?.value).toBe("Entered wrongly");
    const tax = toCanonicalRequest("partner-tax-rule", row("partner-tax-rule", { reason: "Replace TDS rule: 10% to 5%" }), NOW, null);
    expect(tax.evidence.find((e) => e.key === "change")?.value).toBe("Replace TDS rule: 10% to 5%");
  });

  it("each kind has a summary that says what approving does, not just its name", () => {
    const sum = (kind: NativeKind, over: Partial<RequestRow>, facts: Parameters<typeof toCanonicalRequest>[3] = null) => toCanonicalRequest(kind, row(kind, over), NOW, facts).summary;
    expect(sum("payout-run", {}, PAYOUT_FACTS)).toBe("Approve the partner payout run for 1 Mar 2027 to 31 Mar 2027: 4 payouts, ₹1,20,000.00 net.");
    expect(sum("commission-adjustment", { payload: { amount: -2500.5, reason: "Overpaid" } })).toBe("Adjust one payout by -₹2,500.50: Overpaid");
    expect(sum("erasure-request", {})).toBe("Mark this erasure request approved. The data is deleted in a separate step by an Admin.");
    expect(sum("stage-override", { payload: { clientId: "c9", toStageId: "s2", reason: "Entered wrongly" } })).toBe("Move a customer to a different stage: Entered wrongly");
    expect(sum("partner-tax-rule", { reason: "Replace TDS rule: 10% to 5%" })).toBe("Replace TDS rule: 10% to 5%");
  });

  it("the closed-loop kinds show the destination, regions and wording, never a credential or an identifier, and link to the Closed loop workspace", () => {
    const dest = toCanonicalRequest("closed-loop-destination", row("closed-loop-destination", { entity: "ClosedLoopDestination", entityId: "meta_capi", payload: { destination: "meta_capi", enabled: true, region: "in", allowedRegions: ["in", "global"], sendValue: true, accessToken: "SECRET" } }), NOW, null);
    expect(dest.evidence.map((e) => e.key)).toEqual(["destination", "regions", "value"]);
    expect(dest.evidence.find((e) => e.key === "regions")?.value).toBe("in / in, global");
    expect(dest.subject).toMatchObject({ type: "Ad destination", href: "/closed-loop?tab=destinations" });
    expect(JSON.stringify(dest)).not.toContain("SECRET");
    const notice = toCanonicalRequest("consent-policy-change", row("consent-policy-change", { payload: { purpose: "ADS_MEASUREMENT", text: "We may tell ad platforms, with coded identifiers only, that you funded.", version: "2027-04" } }), NOW, null);
    expect(notice.evidence.find((e) => e.key === "version")?.value).toBe("2027-04");
    expect(notice.subject.href).toBe("/closed-loop?tab=coverage");
    expect(notice.summary).toMatch(/consent/i);
  });

  it("missing facts give missing evidence, not an invented value", () => {
    const v = toCanonicalRequest("payout-run", row("payout-run"), NOW, null);
    expect(v.evidence.find((e) => e.key === "period")).toBeUndefined();
  });
});

describe("approval request: access follows the generic registry's roles", () => {
  it("payout run: Admin decides; Finance only sees their own request", async () => {
    const { svc } = setup("payout-run", [row("payout-run")]);
    expect((await svc.listFor(admin, { tab: "awaiting" })).items.map((i) => i.id)).toEqual(["r1"]);
    expect((await svc.listFor(finance, { tab: "awaiting" })).items).toEqual([]);
    expect((await svc.listFor(maker, { tab: "mine" })).items.map((i) => i.id)).toEqual(["r1"]);
    expect((await svc.listFor(finance, { tab: "mine" })).items).toEqual([]);
    expect((await svc.listFor(rm, { tab: "mine" })).items).toEqual([]);
  });

  it("stage correction: a manager sees only their own; the Admin decides", async () => {
    const { svc } = setup("stage-override", [row("stage-override", { requestedById: "mgr" })]);
    expect((await svc.listFor(manager, { tab: "mine" })).items.map((i) => i.id)).toEqual(["r1"]);
    expect((await svc.listFor(manager, { tab: "awaiting" })).items).toEqual([]);
    expect((await svc.listFor(admin, { tab: "awaiting" })).items).toHaveLength(1);
  });

  it("tax rule: Finance decides someone else's request but not their own", async () => {
    const { svc } = setup("partner-tax-rule", [row("partner-tax-rule", { requestedById: "fin", payload: { op: "create", rule: {} } }), row("partner-tax-rule", { id: "r2", payload: { op: "create", rule: {} } })]);
    expect((await svc.listFor(finance, { tab: "awaiting" })).items.map((i) => i.id)).toEqual(["r2"]);
  });
});

describe("approval request: decisions go through the generic service unchanged", () => {
  it("approve calls decideApproval with APPROVED, the note and the actor, and passes the hold override", async () => {
    const { svc, decide } = setup("payout-run", [row("payout-run")]);
    const r = await svc.decide(admin, "payout-run:r1", "approve", { reason: "ok", params: { holdOverrideReason: "Bank confirmed by phone" } });
    expect(r.ok).toBe(true);
    expect(decide).toHaveBeenCalledWith("r1", "APPROVED", "ok", { id: "adm", role: "ADMIN" }, { holdOverrideReason: "Bank confirmed by phone" });
  });

  it("reject calls it with REJECTED and the reason", async () => {
    const { svc, decide } = setup("payout-run", [row("payout-run")]);
    await svc.decide(admin, "payout-run:r1", "reject", { reason: "Wrong period" });
    expect(decide).toHaveBeenCalledWith("r1", "REJECTED", "Wrong period", { id: "adm", role: "ADMIN" }, undefined);
  });

  it("maps the generic service's failures to codes, and a blocked approval keeps its reasons", async () => {
    const cases: [Error, string][] = [
      [new Error("Maker cannot also be checker of their own request"), "SELF_APPROVAL"], [new Error("Approval request already APPROVED"), "ALREADY_DECIDED"], [new Error("Approval request has expired"), "EXPIRED"],
      [new Error("Not authorized to decide this request"), "FORBIDDEN"], [new Error("Approval request not found"), "NOT_FOUND"], [new Error("boom: constraint xyz"), "ERROR"],
    ];
    for (const [err, code] of cases) {
      const { adapter } = setup("payout-run", [row("payout-run")], { decide: vi.fn(async () => { throw err; }) });
      const r = await adapter.decide({ subjectId: "r1", decision: "approve", reason: null, actor: admin, now: NOW, params: {} });
      expect(r, err.message).toMatchObject({ ok: false, code });
    }
    const blocked = Object.assign(new Error("Blocked"), { name: "ApprovalBlockedError", reasons: ["Partner A is suspended"] });
    const { adapter } = setup("payout-run", [row("payout-run")], { decide: vi.fn(async () => { throw blocked; }) });
    expect(await adapter.decide({ subjectId: "r1", decision: "approve", reason: null, actor: admin, now: NOW, params: {} })).toEqual({ ok: false, code: "BLOCKED", error: "Blocked", reasons: ["Partner A is suspended"] });
  });

  it("an internal error never leaks its message", async () => {
    const { adapter } = setup("payout-run", [row("payout-run")], { decide: vi.fn(async () => { throw new Error("duplicate key value violates unique constraint payout_pkey"); }) });
    const r = await adapter.decide({ subjectId: "r1", decision: "approve", reason: null, actor: admin, now: NOW, params: {} });
    expect(r).toMatchObject({ ok: false, code: "ERROR" });
    expect(JSON.stringify(r)).not.toMatch(/payout_pkey|duplicate key/);
  });

  it("only requests of its own kind are visible through it", async () => {
    const { adapter } = setup("payout-run", [row("payout-run", { actionType: "ERASURE_REQUEST" })]);
    expect(await adapter.get("r1", admin, NOW)).toBeNull();
  });

  it("the expiry the clock set is recorded the way the generic service records it", async () => {
    const { adapter, decide } = setup("payout-run", [row("payout-run", { expiresAt: new Date(NOW.getTime() - 5) })]);
    const v = await adapter.get("r1", admin, NOW);
    expect(v?.state).toBe("expired");
    await adapter.expire!("r1", NOW);
    expect(decide).not.toHaveBeenCalled(); // expiry is recorded by a compare-and-set, not by a decision
  });
});

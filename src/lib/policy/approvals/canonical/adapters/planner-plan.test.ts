import { describe, expect, it } from "vitest";

import { buildChecklist, decideTransition, type ChecklistContext, type ChecklistItem, type PlanForFlow, type PlanStatus } from "@/lib/planner/workflow";

import { definitionOf, mayApprove, mayRequest } from "../definitions";
import { createApprovalService } from "../service";
import { createPlannerPlanAdapter, toCanonicalPlannerPlan, type PlanApprovalRow } from "./planner-plan";

const NOW = new Date("2027-04-20T09:00:00Z");
const TODAY = "2027-04-20";
const maker = { id: "u-m", role: "MARKETING" } as const;
const admin = { id: "u-a", role: "ADMIN" } as const;
const marketing2 = { id: "u-m2", role: "MARKETING" } as const;
const rm = { id: "u-rm", role: "RM" } as const;

const good: ChecklistContext = { promiseOk: true, destination: { status: "LIVE", patternOk: true }, linksTested: true, routing: { via: "rule", ownerId: "rm-1" }, consentPurpose: "MARKETING_COMMS", copies: [{ status: "APPROVED" }], creator: null, channel: "search_ad" };

function world(over: { status?: PlanStatus; ctx?: Partial<ChecklistContext>; reviewNote?: string | null } = {}) {
  const plan = { status: (over.status ?? "NEEDS_REVIEW") as PlanStatus, approvedById: null as string | null, note: over.reviewNote ?? null, createdById: maker.id };
  const checklist = (): ChecklistItem[] => buildChecklist({ ...good, ...over.ctx });
  const flow = (): PlanForFlow => ({ status: plan.status, createdById: plan.createdById, ownerId: "o", startDate: "2027-05-01", endDate: null, linksTestedAt: new Date(), approvedById: plan.approvedById, channel: "search_ad" });
  const service = {
    async transition(_id: string, action: "approve" | "request_changes", input: { actor: { id: string; role: string }; confirmed?: boolean; note?: string }) {
      const d = decideTransition({ plan: flow(), action, actor: input.actor.id, checklist: checklist(), today: TODAY, confirmed: input.confirmed, note: input.note });
      if (!d.ok) return { ok: false as const, error: d.error };
      plan.status = d.to;
      if (action === "approve") plan.approvedById = input.actor.id;
      if (action === "request_changes") plan.note = input.note ?? null;
      return { ok: true as const };
    },
  };
  const row = (): PlanApprovalRow => ({ id: "pl1", code: "CP-ABC234", title: "Retirement search", status: plan.status, channelLabel: "Search ad", audienceName: "Salaried professionals", promiseHook: "See if you are on track for retirement", destinationName: "Retirement planner", destinationStatus: "LIVE", checklist: checklist(), createdById: plan.createdById, authorName: "Maya", submittedAt: NOW, approvedById: plan.approvedById, approvedAt: plan.approvedById ? NOW : null, reviewNote: plan.note, budgetInr: 50000, startDate: "2027-05-01", endDate: null });
  const adapter = createPlannerPlanAdapter({ service, loadAwaiting: async () => (plan.status === "NEEDS_REVIEW" ? [row()] : []), loadRequestedBy: async (id) => (id === maker.id ? [row()] : []), loadRow: async () => row() });
  const svc = createApprovalService({ adapters: { "planner-plan": adapter }, now: () => NOW, audit: async () => undefined, writeThrough: () => false, mirror: async () => undefined, consentGate: () => undefined });
  return { plan, adapter, svc, row };
}

describe("planner-plan definition", () => {
  it("is a marketing approval with four-eyes, approved by Admin and Marketing, drafts only (L3), never auto-approved", () => {
    const d = definitionOf("planner-plan");
    expect(d).toMatchObject({ group: "marketing", fourEyes: true, adapter: "read-through", writeThroughFlag: "APPROVALS_WT_PLANNER_PLAN", autoApprove: "never" });
    expect(d.autonomy).toMatchObject({ level: "L3", customerFacing: true, adSpend: false });
    expect(d.approveNeeds).toContain("confirmed");
    for (const r of ["ADMIN", "MARKETING"] as const) { expect(mayApprove(r, "planner-plan")).toBe(true); expect(mayRequest(r, "planner-plan")).toBe(true); }
    for (const r of ["RM", "MANAGER", "FINANCE", "TEAM_MANAGER", "DEALER", "PARTNER"] as const) { expect(mayApprove(r, "planner-plan"), r).toBe(false); expect(mayRequest(r, "planner-plan"), r).toBe(false); }
  });
});

describe("plan view", () => {
  it("maps the plan workflow onto canonical states", () => {
    const w = world();
    const st = (status: PlanStatus, extra: Partial<PlanApprovalRow> = {}) => toCanonicalPlannerPlan({ ...w.row(), status, ...extra })?.state;
    expect(st("NEEDS_REVIEW")).toBe("requested");
    expect(st("APPROVED")).toBe("approved");
    expect(st("SCHEDULED")).toBe("approved");
    expect(st("DRAFT")).toBeUndefined();
    expect(st("DRAFT", { reviewNote: "Link the right destination" })).toBe("rejected");
  });
  it("carries the promise, the checklist and four-eyes", () => {
    const v = toCanonicalPlannerPlan(world().row())!;
    expect(v).toMatchObject({ ref: "planner-plan:pl1", kind: "planner-plan", fourEyesAuthorId: "u-m", autonomy: "L3", clientId: null });
    expect(v.subject.href).toBe("/planner/pl1");
    expect(v.evidence.map((e) => e.key)).toEqual(expect.arrayContaining(["plan", "checklist"]));
    expect(v.evidence.find((e) => e.key === "checklist")?.value).toMatch(/pass/i);
  });
  it("lists failing checklist items in the evidence", () => {
    const v = toCanonicalPlannerPlan(world({ ctx: { linksTested: false } }).row())!;
    expect(v.evidence.find((e) => e.key === "checklist")?.value).toMatch(/Tracking links tested/);
  });
  it("is invisible outside the marketing roles", async () => {
    const w = world();
    expect(await w.adapter.get("pl1", maker, NOW)).not.toBeNull();
    expect(await w.adapter.get("pl1", rm, NOW)).toBeNull();
    expect(await w.adapter.listAwaiting(rm, NOW, 10)).toEqual([]);
  });
});

describe("deciding through the canonical service keeps the planner's own rules", () => {
  it("a second person approves, with the tick", async () => {
    const w = world();
    const r = await w.svc.decide(admin, "planner-plan:pl1", "approve", { reason: null, params: { confirmed: true } });
    expect(r.ok).toBe(true);
    expect(w.plan).toMatchObject({ status: "APPROVED", approvedById: "u-a" });
  });
  it("four-eyes: the author cannot approve their own plan", async () => {
    const w = world();
    expect(await w.svc.decide(maker, "planner-plan:pl1", "approve", { reason: null, params: { confirmed: true } })).toMatchObject({ ok: false, code: "SELF_APPROVAL" });
    expect(w.plan.status).toBe("NEEDS_REVIEW");
  });
  it("the checklist is re-checked at the gate: a failing item blocks approval", async () => {
    const w = world({ ctx: { destination: { status: "PLANNED", patternOk: true } } });
    const r = await w.svc.decide(admin, "planner-plan:pl1", "approve", { reason: null, params: { confirmed: true } });
    expect(r).toMatchObject({ ok: false, code: "BLOCKED" });
    expect(w.plan.status).toBe("NEEDS_REVIEW");
  });
  it("a product claim without registry approval blocks it (fails closed)", async () => {
    const w = world({ ctx: { product: { mentions: true, cited: false } } });
    expect(await w.svc.decide(admin, "planner-plan:pl1", "approve", { reason: null, params: { confirmed: true } })).toMatchObject({ ok: false, code: "BLOCKED" });
  });
  it("an unregistered short-video creator blocks it", async () => {
    const w = world({ ctx: { channel: "short_video", creator: { sebiRegistration: null } } });
    expect(await w.svc.decide(admin, "planner-plan:pl1", "approve", { reason: null, params: { confirmed: true } })).toMatchObject({ ok: false, code: "BLOCKED" });
  });
  it("needs the tick, and a note to ask for changes", async () => {
    const w = world();
    expect(await w.svc.decide(admin, "planner-plan:pl1", "approve", { reason: null, params: {} })).toMatchObject({ ok: false, code: "NEEDS_INPUT" });
    expect(await w.svc.decide(admin, "planner-plan:pl1", "reject", { reason: null, params: {} })).toMatchObject({ ok: false });
    const ok = await w.svc.decide(admin, "planner-plan:pl1", "reject", { reason: "Pick a live destination", params: {} });
    expect(ok.ok).toBe(true);
    expect(w.plan).toMatchObject({ status: "DRAFT", note: "Pick a live destination" });
  });
  it("a second decision on a decided plan is refused", async () => {
    const w = world();
    await w.svc.decide(admin, "planner-plan:pl1", "approve", { reason: null, params: { confirmed: true } });
    expect(await w.svc.decide(marketing2, "planner-plan:pl1", "approve", { reason: null, params: { confirmed: true } })).toMatchObject({ ok: false });
  });
  it("a role outside marketing cannot decide, and cannot see it exists", async () => {
    const w = world();
    expect(await w.svc.decide(rm, "planner-plan:pl1", "approve", { reason: null, params: { confirmed: true } })).toMatchObject({ ok: false });
    expect(w.plan.status).toBe("NEEDS_REVIEW");
  });
});

import { describe, expect, it } from "vitest";

import { checkOutbound } from "@/lib/agents/guardrails";

import { buildPushContext, closeClockForClient, firstMessageDraft, pushNewLead, sweepLeadPushes, topicFor, type PushDeps, type PushRow, type SweepDeps } from "./lead-push";
import type { Touch } from "./model";

const NOW = new Date("2027-03-02T05:00:00Z");
const touch = (over: Partial<Touch> = {}): Touch => ({
  kind: "meta_ad", at: NOW.toISOString(), creative: "Retire at 55 carousel", form: "F9", code: null, confidence: "high", rule: "campaign_id",
  campaign: { key: "meta:111", id: "111", name: "Retirement Planning - Lead Form", inSpendData: true }, why: "x", ...over,
});

describe("topicFor and the suggested first message", () => {
  it("picks a plain topic from the campaign, creative or product interest", () => {
    expect(topicFor({ campaign: "Retirement Planning - Lead Form" })).toBe("retirement planning");
    expect(topicFor({ campaign: "ELSS Tax Saving" })).toBe("tax saving");
    expect(topicFor({ campaign: "NRI Investing - Search" })).toBe("investing from abroad");
    expect(topicFor({ campaign: "PMS Intro" })).toBe("portfolio management");
    expect(topicFor({ productInterest: "Mutual funds" })).toBe("mutual funds");
    expect(topicFor({})).toBe("investing with us");
  });

  it("is a fixed template that passes the outbound guardrails, names no figures or products' returns, and never contains a placeholder", () => {
    for (const campaign of ["Retirement Planning", "ELSS Tax Saving", "NRI Investing", "PMS Intro", "Something else"]) {
      const body = firstMessageDraft({ firstName: "Meera", rmFirstName: "Karan", campaign });
      expect(checkOutbound(body).ok, body).toBe(true);
      expect(body).toMatch(/Meera/);
      expect(body).toMatch(/Karan/);
      expect(body).not.toMatch(/\[|\{|\}|%/);
    }
  });

  it("works without an RM name", () => {
    const body = firstMessageDraft({ firstName: "Meera", rmFirstName: null, campaign: null });
    expect(checkOutbound(body).ok).toBe(true);
    expect(body).not.toMatch(/null|undefined/);
  });
});

describe("buildPushContext", () => {
  it("carries campaign, creative, form and the lead's own answers, trimmed", () => {
    const c = buildPushContext(touch(), { answers: { budget: "5 lakh", goal: "retire early" }, productInterest: "Retirement" });
    expect(c).toMatchObject({ campaign: "Retirement Planning - Lead Form", creative: "Retire at 55 carousel", form: "F9", confidence: "high", answers: { budget: "5 lakh", goal: "retire early" } });
  });
  it("says unattributed when there is no touch", () => {
    expect(buildPushContext(null, { answers: {} })).toMatchObject({ campaign: null, confidence: null });
  });
});

function fakePush(over: Partial<PushDeps> = {}) {
  const log = { created: [] as unknown[], notified: [] as { userIds: string[]; type: string; payload: Record<string, unknown> }[], drafts: [] as unknown[], tasks: [] as unknown[] };
  const deps: PushDeps = {
    now: () => NOW,
    settings: async () => ({ slaMinutes: 15, graceMinutes: 0 }),
    createPush: async (row) => {
      if (log.created.some((r) => (r as { intakeKey: string }).intakeKey === row.intakeKey)) return { created: false, id: "existing" };
      log.created.push(row);
      return { created: true, id: `push-${log.created.length}` };
    },
    notify: async (userIds, type, payload) => void log.notified.push({ userIds, type, payload }),
    pool: async () => ["mgr-1", "admin-1"],
    createDraft: async (args) => (log.drafts.push(args), { status: "drafted", proposalId: "prop-1" }),
    attachDraft: async () => {},
    ...over,
  };
  return { deps, log };
}

const lead = { clientId: "c1", clientName: "Meera Iyer", firstName: "Meera", assignedToId: "rm-1", rmFirstName: "Karan", intakeKey: "meta_leads:L1", touch: touch(), answers: { goal: "retire early" }, productInterest: "Retirement" };

describe("pushNewLead", () => {
  it("records the push with the SLA clock, notifies the assigned RM with the campaign context, and drafts a first message (nothing is sent)", async () => {
    const { deps, log } = fakePush();
    const out = await pushNewLead(lead, deps);
    expect(out).toMatchObject({ status: "pushed", pushId: "push-1", draft: { status: "drafted" } });
    expect((log.created[0] as PushRow).dueAt).toEqual(new Date("2027-03-02T05:15:00Z"));
    expect((log.created[0] as PushRow).slaMinutes).toBe(15);
    expect(log.notified).toHaveLength(1);
    expect(log.notified[0]).toMatchObject({ userIds: ["rm-1"], type: "lead_push" });
    expect(log.notified[0].payload).toMatchObject({ clientId: "c1", clientName: "Meera Iyer", campaign: "Retirement Planning - Lead Form", creative: "Retire at 55 carousel", dueAt: "2027-03-02T05:15:00.000Z" });
    expect(log.drafts).toHaveLength(1);
  });

  it("an unassigned lead goes to the people who assign leads, and gets no draft (there is nobody to approve it)", async () => {
    const { deps, log } = fakePush();
    const out = await pushNewLead({ ...lead, assignedToId: null }, deps);
    expect(out.status).toBe("pushed");
    expect(log.notified[0]).toMatchObject({ userIds: ["mgr-1", "admin-1"], type: "lead_push" });
    expect(log.notified[0].payload).toMatchObject({ unassigned: true });
    expect(log.drafts).toHaveLength(0);
  });

  it("a replay of the same submission does nothing twice", async () => {
    const { deps, log } = fakePush();
    await pushNewLead(lead, deps);
    const again = await pushNewLead(lead, deps);
    expect(again).toEqual({ status: "skipped", reason: "already pushed" });
    expect(log.notified).toHaveLength(1);
    expect(log.drafts).toHaveLength(1);
  });

  it("a draft that is skipped or blocked never stops the push", async () => {
    const { deps, log } = fakePush({ createDraft: async () => ({ status: "skipped", reason: "no consent" }) });
    const out = await pushNewLead(lead, deps);
    expect(out).toMatchObject({ status: "pushed", draft: { status: "skipped" } });
    expect(log.notified).toHaveLength(1);
  });

  it("a failing draft or notification is swallowed: the lead is never lost", async () => {
    const { deps } = fakePush({ createDraft: async () => { throw new Error("boom"); }, notify: async () => { throw new Error("down"); } });
    await expect(pushNewLead(lead, deps)).resolves.toMatchObject({ status: "pushed" });
  });
});

describe("sweepLeadPushes", () => {
  const open = (over: Partial<PushRow & { id: string; status: string; clientName: string }> = {}) => ({
    id: "p1", clientId: "c1", clientName: "Meera Iyer", intakeKey: "k", assignedToId: "rm-1", slaMinutes: 15, dueAt: new Date("2027-03-02T05:15:00Z"), status: "OPEN", campaign: "Retirement Planning", createdAt: new Date("2027-03-02T05:00:00Z"), ...over,
  });
  function fakeSweep(rows: ReturnType<typeof open>[], over: Partial<SweepDeps> = {}) {
    const log = { updates: [] as { id: string; data: Record<string, unknown> }[], tasks: [] as Record<string, unknown>[], notes: [] as { userIds: string[]; type: string; payload: Record<string, unknown> }[] };
    const deps: SweepDeps = {
      now: () => new Date("2027-03-02T05:30:00Z"),
      settings: async () => ({ slaMinutes: 15, graceMinutes: 0 }),
      listOpen: async () => rows,
      contactedAt: async () => null,
      escalationTargets: async () => ["mgr-1"],
      createTask: async (t) => (log.tasks.push(t), { id: "task-1" }),
      notify: async (userIds, type, payload) => void log.notes.push({ userIds, type, payload }),
      update: async (id, data) => void log.updates.push({ id, data }),
      ...over,
    };
    return { deps, log };
  }

  it("marks a push contacted when a person has reached the customer, with when", async () => {
    const at = new Date("2027-03-02T05:09:00Z");
    const { deps, log } = fakeSweep([open()], { contactedAt: async () => at });
    expect(await sweepLeadPushes(deps)).toEqual({ contacted: 1, escalated: 0, waiting: 0 });
    expect(log.updates).toEqual([{ id: "p1", data: { status: "CONTACTED", contactedAt: at } }]);
    expect(log.tasks).toHaveLength(0);
  });

  it("escalates a breach to the manager as a task and a notification, once", async () => {
    const { deps, log } = fakeSweep([open()]);
    expect(await sweepLeadPushes(deps)).toEqual({ contacted: 0, escalated: 1, waiting: 0 });
    expect(log.tasks[0]).toMatchObject({ clientId: "c1", assignedToId: "mgr-1", source: "lead-sla:p1" });
    expect(String(log.tasks[0].title)).toMatch(/not contacted/i);
    expect(log.notes[0]).toMatchObject({ userIds: ["mgr-1"], type: "lead_sla_breach" });
    expect(log.updates[0]).toMatchObject({ id: "p1", data: { status: "ESCALATED", escalationTaskId: "task-1" } });
  });

  it("waits while inside the SLA plus the grace period", async () => {
    const early = fakeSweep([open()], { now: () => new Date("2027-03-02T05:10:00Z") });
    expect(await sweepLeadPushes(early.deps)).toEqual({ contacted: 0, escalated: 0, waiting: 1 });
    const grace = fakeSweep([open()], { settings: async () => ({ slaMinutes: 15, graceMinutes: 20 }) });
    expect(await sweepLeadPushes(grace.deps)).toEqual({ contacted: 0, escalated: 0, waiting: 1 });
    expect(grace.log.tasks).toHaveLength(0);
  });

  it("an escalated push that is later contacted becomes contacted and keeps its escalation record", async () => {
    const at = new Date("2027-03-02T06:00:00Z");
    const { deps, log } = fakeSweep([open({ status: "ESCALATED" })], { contactedAt: async () => at });
    await sweepLeadPushes(deps);
    expect(log.updates).toEqual([{ id: "p1", data: { status: "CONTACTED", contactedAt: at } }]);
  });

  it("an escalated push still not contacted is left alone (no second task)", async () => {
    const { deps, log } = fakeSweep([open({ status: "ESCALATED" })]);
    expect(await sweepLeadPushes(deps)).toEqual({ contacted: 0, escalated: 0, waiting: 0 });
    expect(log.tasks).toHaveLength(0);
  });

  it("one failing push does not stop the others", async () => {
    let n = 0;
    const { deps, log } = fakeSweep([open({ id: "a", clientId: "ca" }), open({ id: "b", clientId: "cb" })], { createTask: async (t) => { if (n++ === 0) throw new Error("db"); log.tasks.push(t); return { id: "t" }; } });
    const out = await sweepLeadPushes(deps);
    expect(out.escalated).toBe(1);
  });
});

describe("events (CUSTOMER_EVENTS_ENABLED, through emit): the push, the breach and the speed to contact", () => {
  it("a push emits one pushed event with the clock and whether anyone owns the lead", async () => {
    const seen: unknown[] = [];
    const { deps } = fakePush({ events: { pushed: async (e) => void seen.push(e) } });
    await pushNewLead(lead, deps);
    expect(seen).toEqual([{ clientId: "c1", pushId: "push-1", slaMinutes: 15, assigned: true, campaignId: "111", occurredAt: NOW }]);
  });
  it("a replayed submission emits nothing a second time", async () => {
    const seen: unknown[] = [];
    const { deps } = fakePush({ events: { pushed: async (e) => void seen.push(e) } });
    await pushNewLead(lead, deps);
    await pushNewLead(lead, deps);
    expect(seen).toHaveLength(1);
  });
  it("an event that cannot be stored never loses the lead", async () => {
    const { deps } = fakePush({ events: { pushed: async () => { throw new Error("events down"); } } });
    await expect(pushNewLead(lead, deps)).resolves.toMatchObject({ status: "pushed" });
  });
  it("the sweep emits speed to contact for a reached lead and a breach for an escalated one, with minutes", async () => {
    const out: { kind: string; arg: unknown }[] = [];
    const base = { id: "p1", clientId: "c1", clientName: "Meera Iyer", assignedToId: "rm-1", slaMinutes: 15, dueAt: new Date("2027-03-02T05:15:00Z"), status: "OPEN", campaign: "R", createdAt: new Date("2027-03-02T05:00:00Z") };
    const deps = (rows: (typeof base)[], contacted: Date | null): SweepDeps => ({
      now: () => new Date("2027-03-02T05:30:00Z"), settings: async () => ({ slaMinutes: 15, graceMinutes: 0 }), listOpen: async () => rows, contactedAt: async () => contacted,
      escalationTargets: async () => ["mgr-1"], createTask: async () => ({ id: "t1" }), notify: async () => {}, update: async () => {},
      events: { contacted: async (push, at, minutes) => void out.push({ kind: "contacted", arg: { id: push.id, at, minutes } }), breached: async (push, past) => void out.push({ kind: "breached", arg: { id: push.id, past } }) },
    });
    await sweepLeadPushes(deps([base], new Date("2027-03-02T05:09:00Z")));
    await sweepLeadPushes(deps([base], null));
    expect(out).toEqual([{ kind: "contacted", arg: { id: "p1", at: new Date("2027-03-02T05:09:00Z"), minutes: 9 } }, { kind: "breached", arg: { id: "p1", past: 15 } }]);
  });
  it("a failing event never undoes or blocks the escalation", async () => {
    const base = { id: "p1", clientId: "c1", clientName: "M", assignedToId: "rm-1", slaMinutes: 15, dueAt: new Date("2027-03-02T05:15:00Z"), status: "OPEN", campaign: null, createdAt: new Date("2027-03-02T05:00:00Z") };
    const updates: unknown[] = [];
    const d: SweepDeps = { now: () => new Date("2027-03-02T05:30:00Z"), settings: async () => ({ slaMinutes: 15, graceMinutes: 0 }), listOpen: async () => [base], contactedAt: async () => null, escalationTargets: async () => ["mgr-1"], createTask: async () => ({ id: "t1" }), notify: async () => {}, update: async (id, data) => void updates.push({ id, data }), events: { contacted: async () => {}, breached: async () => { throw new Error("down"); } } };
    expect(await sweepLeadPushes(d)).toEqual({ contacted: 0, escalated: 1, waiting: 0 });
    expect(updates).toHaveLength(1);
  });
});

describe("closeClockForClient (the event consumer's whole job: the same definition of contact as the sweep, just sooner)", () => {
  const push = { id: "p1", clientId: "c1", clientName: "M", assignedToId: "rm-1", slaMinutes: 15, dueAt: new Date("2027-03-02T05:15:00Z"), status: "OPEN", campaign: null, createdAt: new Date("2027-03-02T05:00:00Z") };
  it("marks the open pushes of the customer contacted when a person has reached them", async () => {
    const updates: unknown[] = [];
    const at = new Date("2027-03-02T05:04:00Z");
    const n = await closeClockForClient("c1", { openFor: async () => [push], contactedAt: async () => at, update: async (id, data) => void updates.push({ id, data }) });
    expect(n).toBe(1);
    expect(updates).toEqual([{ id: "p1", data: { status: "CONTACTED", contactedAt: at } }]);
  });
  it("emits the speed to contact when it closes the clock (the sweep will not see this push again)", async () => {
    const seen: unknown[] = [];
    await closeClockForClient("c1", { openFor: async () => [push], contactedAt: async () => new Date("2027-03-02T05:04:00Z"), update: async () => {}, events: { contacted: async (p, at, minutes) => void seen.push({ id: p.id, minutes }) } });
    expect(seen).toEqual([{ id: "p1", minutes: 4 }]);
  });
  it("does nothing when nobody has reached them, and is safe to run twice", async () => {
    const updates: unknown[] = [];
    const deps = { openFor: async () => [push], contactedAt: async () => null, update: async (id: string, data: Record<string, unknown>) => void updates.push({ id, data }) };
    expect(await closeClockForClient("c1", deps)).toBe(0);
    expect(await closeClockForClient("c1", deps)).toBe(0);
    expect(updates).toEqual([]);
  });
});

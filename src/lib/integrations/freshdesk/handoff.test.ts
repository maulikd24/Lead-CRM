import { describe, expect, it } from "vitest";
import { processHandoff, type HandoffDeps } from "./handoff";

const NOW = new Date("2026-10-07T10:00:00+05:30"); // Wednesday

const payload = (over: Record<string, unknown> = {}) => ({
  ticket_id: "77",
  ticket_url: "https://acme.freshdesk.com/a/tickets/77",
  requester_email: "riya@example.com",
  subject: "Status of my account",
  priority: 3,
  status: 2,
  channel: "Live Chat",
  tags: "ai_handoff",
  ai_summary: "Asked about KYC status, wants a call.",
  ai_intent: "KYC status",
  ai_sentiment: "neutral",
  updated_at: "2026-10-07T04:00:00Z",
  ...over,
});

function fakes(opts: { client?: { id: string; assignedToId: string | null; name: string } | null } = {}) {
  const calls = { activities: [] as { clientId: string; payload: Record<string, unknown>; createdAt?: Date }[], updated: [] as { id: string; payload: Record<string, unknown> }[], tasks: [] as Record<string, unknown>[], insights: [] as Record<string, unknown>[], logs: [] as string[] };
  let stored: { id: string; payload: Record<string, unknown> } | null = null;
  const deps: HandoffDeps = {
    now: () => NOW,
    resolveClient: async () => (opts.client === undefined ? { id: "c1", assignedToId: "rm1", name: "Riya" } : opts.client),
    findExisting: async () => stored,
    createActivity: async (clientId, p, createdAt) => {
      calls.activities.push({ clientId, payload: p, createdAt });
      stored = { id: "a1", payload: p };
      return { id: "a1" };
    },
    updateActivity: async (id, p) => {
      calls.updated.push({ id, payload: p });
      stored = { id, payload: p };
    },
    createTask: async (t) => {
      calls.tasks.push(t);
      return { id: "t1" };
    },
    recordServiceIssue: async (i) => {
      calls.insights.push(i);
    },
    log: (m) => calls.logs.push(m),
  };
  return { deps, calls };
}

describe("processHandoff", () => {
  it("creates a TICKET activity payload, an RM task and no insight for a calm hand-off", async () => {
    const { deps, calls } = fakes();
    const r = await processHandoff(payload(), deps);
    expect(r).toMatchObject({ status: "created", activityId: "a1", taskId: "t1", serviceIssue: false });
    const p = calls.activities[0].payload;
    expect(p).toMatchObject({ source: "freshdesk", eventType: "ai_handoff", handoff: true, ticketId: "77", ticketUrl: "https://acme.freshdesk.com/a/tickets/77", priority: "high" });
    expect(String(p.message)).toMatch(/^Support hand-off: KYC status — /);
    expect(JSON.stringify(p)).not.toContain("riya@example.com");
    expect(calls.tasks[0]).toMatchObject({ clientId: "c1", assignedToId: "rm1", title: "Follow up on support hand-off", source: "freshdesk-handoff:77" });
    // high = one working day: Wed 10:00 -> Thu 10:00 (9 business hours from 10:00 -> Thu 10:00)
    expect((calls.tasks[0].dueAt as Date).toISOString()).toBe(new Date("2026-10-08T10:00:00+05:30").toISOString());
    expect(calls.insights).toHaveLength(0);
  });
  it("urgent due in 2 hours", async () => {
    const { deps, calls } = fakes();
    await processHandoff(payload({ priority: 4 }), deps);
    expect((calls.tasks[0].dueAt as Date).toISOString()).toBe(new Date("2026-10-07T12:00:00+05:30").toISOString());
  });
  it("negative sentiment: high priority, service issue recorded", async () => {
    const { deps, calls } = fakes();
    const r = await processHandoff(payload({ priority: 1, ai_sentiment: "negative" }), deps);
    expect(r).toMatchObject({ status: "created", serviceIssue: true });
    expect(calls.activities[0].payload).toMatchObject({ priority: "high", ticketPriority: "low", escalated: true });
    expect(calls.insights[0]).toMatchObject({ clientId: "c1", activityId: "a1" });
  });
  it("compliance wording escalates the same way", async () => {
    const { deps, calls } = fakes();
    await processHandoff(payload({ ai_summary: "Customer wants a refund and mentions SEBI" }), deps);
    expect(calls.insights).toHaveLength(1);
  });
  it("is idempotent by ticket id + updated_at", async () => {
    const { deps, calls } = fakes();
    await processHandoff(payload(), deps);
    expect(await processHandoff(payload(), deps)).toEqual({ status: "duplicate" });
    expect(await processHandoff(payload({ updated_at: "2026-10-07T03:00:00Z" }), deps)).toEqual({ status: "duplicate" });
    expect(calls.activities).toHaveLength(1);
    expect(calls.tasks).toHaveLength(1);
  });
  it("a newer update changes the same entry and keeps the original SLA clock", async () => {
    const { deps, calls } = fakes();
    await processHandoff(payload(), deps);
    const first = calls.activities[0].payload;
    const r = await processHandoff(payload({ status: 4, updated_at: "2026-10-07T08:00:00Z" }), deps);
    expect(r).toMatchObject({ status: "updated", activityId: "a1" });
    expect(calls.activities).toHaveLength(1);
    const u = calls.updated[0].payload;
    expect(u.ticketStatus).toBe("resolved");
    expect(u.handoffAt).toBe(first.handoffAt);
    expect(u.resolutionDueAt).toBe(first.resolutionDueAt);
    expect(typeof u.resolvedAt).toBe("string");
    expect(calls.tasks).toHaveLength(1);
  });
  it("skips non hand-offs, missing contact, unknown client without touching anything", async () => {
    const { deps, calls } = fakes({ client: null });
    expect(await processHandoff(payload({ tags: "vip" }), deps)).toEqual({ status: "skipped", reason: "not_handoff" });
    expect(await processHandoff(payload({ requester_email: "", requester_phone: "" }), deps)).toEqual({ status: "skipped", reason: "no_contact" });
    expect(await processHandoff(payload(), deps)).toEqual({ status: "skipped", reason: "no_client" });
    expect(calls.activities).toHaveLength(0);
  });
  it("still records the hand-off when the client has no RM, without a task", async () => {
    const { deps, calls } = fakes({ client: { id: "c2", assignedToId: null, name: "X" } });
    const r = await processHandoff(payload(), deps);
    expect(r).toMatchObject({ status: "created", taskId: null });
    expect(calls.tasks).toHaveLength(0);
  });
  it("never logs raw contact details", async () => {
    const { deps, calls } = fakes();
    await processHandoff(payload(), deps);
    expect(calls.logs.join(" ")).not.toMatch(/riya@example|Status of my account/);
  });
});

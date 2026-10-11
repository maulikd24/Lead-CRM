/**
 * Real-database tests of complaint and commitment handling: links over tickets, insights and tasks (not copies), the SLA clock,
 * resolve / reopen with its window, commitments that start as suggestions and are never overdue until a person accepts them,
 * compare-and-set under a race, role scope of the queue, and an audit chain with no content.
 *   SERVICE_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch db> npx vitest run src/lib/service/service.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.SERVICE_DB_TEST === "1" && local;

const SECRET = "Quorvain Delacroix-Nell";
const NOW = new Date("2027-06-30T10:00:00Z");
const h = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

describe.skipIf(!enabled)("complaints and commitments (real database)", () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let store: typeof import("./store");
  let read: typeof import("./read");
  let svc: typeof import("./service");
  let rm1 = ""; let rm2 = ""; let mgr = ""; let admin = ""; let mkt = "";
  let c1 = ""; let c2 = ""; let ticketOfC1 = ""; let ticketOfC2 = ""; let insightC1 = ""; let commitInsight = ""; let commitInsightNoDue = "";

  beforeAll(async () => {
    db = (await import("@/lib/db/prisma")).basePrisma;
    store = await import("./store");
    read = await import("./read");
    svc = await import("./service");
    const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "Svc stage", sequence: 9201, slaHours: 24 } }));
    const mk = (email: string, role: "RM" | "MANAGER" | "ADMIN" | "MARKETING", managerId?: string) => db.user.upsert({ where: { email }, update: {}, create: { name: email, email, passwordHash: "x", role, managerId } });
    mgr = (await mk("svc-mgr@example.test", "MANAGER")).id;
    rm1 = (await mk("svc-rm1@example.test", "RM", mgr)).id;
    rm2 = (await mk("svc-rm2@example.test", "RM")).id;
    admin = (await mk("svc-admin@example.test", "ADMIN")).id;
    mkt = (await mk("svc-mkt@example.test", "MARKETING")).id;
    c1 = (await db.client.create({ data: { clientCode: "SVC-0001", name: "Service One", currentStageId: stage.id, assignedToId: rm1 } })).id;
    c2 = (await db.client.create({ data: { clientCode: "SVC-0002", name: "Service Two", currentStageId: stage.id, assignedToId: rm2 } })).id;
    ticketOfC1 = (await db.supportTicket.create({ data: { clientId: c1, provider: "freshdesk", externalId: "svc-t1", subject: `Complaint about ${SECRET}`, ticketCreatedAt: h(-30) } })).id;
    ticketOfC2 = (await db.supportTicket.create({ data: { clientId: c2, provider: "freshdesk", externalId: "svc-t2", subject: "Complaint", ticketCreatedAt: h(-3) } })).id;
    insightC1 = (await db.conversationInsight.create({ data: { clientId: c1, kind: "COMPLAINT", text: "Unhappy about the delay", severity: "high", sourceType: "NOTE", sourceRef: "n", dedupeKey: "svc-i1", occurredAt: h(-5) } })).id;
    commitInsight = (await db.conversationInsight.create({ data: { clientId: c1, kind: "COMMITMENT", text: "RM to send the statement", sourceType: "NOTE", sourceRef: "n", dedupeKey: "svc-i2", occurredAt: h(-100), dueAt: h(-50) } })).id;
    commitInsightNoDue = (await db.conversationInsight.create({ data: { clientId: c1, kind: "COMMITMENT", text: "RM to call back sometime", sourceType: "NOTE", sourceRef: "n", dedupeKey: "svc-i3", occurredAt: h(-100) } })).id;
  });

  afterAll(async () => {
    if (!db) return;
    const ids = [c1, c2].filter(Boolean);
    const tasks = await db.task.findMany({ where: { clientId: { in: ids } }, select: { id: true } });
    await db.complaintEvent.deleteMany({ where: { complaint: { clientId: { in: ids } } } });
    await db.complaint.deleteMany({ where: { clientId: { in: ids } } });
    await db.commitment.deleteMany({ where: { clientId: { in: ids } } });
    void tasks;
    await db.task.deleteMany({ where: { clientId: { in: ids } } });
    await db.conversationInsight.deleteMany({ where: { clientId: { in: ids } } });
    await db.supportTicket.deleteMany({ where: { clientId: { in: ids } } });
    await db.client.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  });

  it("registers a complaint from a ticket: linked, SLA clock from when the ticket was raised, a task for the owner, and one case per ticket", async () => {
    const r = await store.registerComplaint({ clientId: c1, title: "Delayed withdrawal", severity: "HIGH", source: { type: "TICKET", ref: ticketOfC1 }, actorId: rm1, now: NOW });
    expect(r).toMatchObject({ ok: true, existed: false });
    if (!r.ok) return;
    const row = await db.complaint.findUniqueOrThrow({ where: { id: r.complaintId } });
    expect(row).toMatchObject({ status: "OPEN", severity: "HIGH", ownerId: rm1, supportTicketId: ticketOfC1, sourceType: "TICKET" });
    expect(row.openedAt.getTime()).toBe(h(-30).getTime());
    expect(row.slaDueAt.getTime()).toBe(h(-30).getTime() + 48 * 3_600_000); // already 18h left of 48h
    const task = await db.task.findUniqueOrThrow({ where: { id: row.taskId! } });
    expect(task).toMatchObject({ clientId: c1, assignedToId: rm1, source: `complaint:${row.id}` });
    // the ticket is untouched: nothing was copied or moved
    expect((await db.supportTicket.findUniqueOrThrow({ where: { id: ticketOfC1 } })).subject).toContain(SECRET);
    expect(await store.registerComplaint({ clientId: c1, title: "again", severity: "LOW", source: { type: "TICKET", ref: ticketOfC1 }, actorId: rm1, now: NOW })).toMatchObject({ ok: true, existed: true, complaintId: r.complaintId });
    expect(await db.complaint.count({ where: { clientId: c1 } })).toBe(1);
  });

  it("refuses a source that belongs to another customer, and an actor that is not a person", async () => {
    expect(await store.registerComplaint({ clientId: c1, title: "x", severity: "LOW", source: { type: "TICKET", ref: ticketOfC2 }, actorId: rm1, now: NOW })).toMatchObject({ ok: false, code: "SOURCE_NOT_FOUND" });
    expect(await store.registerComplaint({ clientId: c1, title: "x", severity: "LOW", source: { type: "MANUAL" }, actorId: "system", now: NOW })).toMatchObject({ ok: false, code: "ACTOR_REQUIRED" });
  });

  it("walks start, resolve, reopen: statuses, history, the linked task, the reopen counter and the new clock", async () => {
    const c = await db.complaint.findFirstOrThrow({ where: { clientId: c1 } });
    expect(await store.actOnComplaint(c.id, { type: "start", actorId: rm1 }, { now: NOW })).toMatchObject({ ok: true, status: "IN_PROGRESS" });
    expect(await store.actOnComplaint(c.id, { type: "resolve", actorId: rm1, resolutionCode: "", resolution: "" }, { now: NOW })).toMatchObject({ ok: false, code: "RESOLUTION_REQUIRED" });
    expect(await store.actOnComplaint(c.id, { type: "resolve", actorId: rm1, resolutionCode: "REFUNDED", resolution: "Paid out and explained" }, { now: NOW })).toMatchObject({ ok: true, status: "RESOLVED" });
    expect((await db.task.findUniqueOrThrow({ where: { id: c.taskId! } })).status).toBe("DONE");
    const later = new Date(NOW.getTime() + 2 * 86_400_000);
    expect(await store.actOnComplaint(c.id, { type: "reopen", actorId: rm1, reason: "Refund bounced" }, { now: later })).toMatchObject({ ok: true, status: "REOPENED" });
    const re = await db.complaint.findUniqueOrThrow({ where: { id: c.id } });
    expect(re).toMatchObject({ status: "REOPENED", reopenedCount: 1, resolvedAt: null });
    expect(re.slaDueAt.getTime()).toBe(later.getTime() + 48 * 3_600_000);
    const events = (await db.complaintEvent.findMany({ where: { complaintId: c.id }, orderBy: { at: "asc" } })).map((e) => e.type);
    expect(events).toEqual(["opened", "started", "resolved", "reopened"]);
    const reopenedTask = await db.task.findUniqueOrThrow({ where: { id: (await db.complaint.findUniqueOrThrow({ where: { id: c.id } })).taskId! } });
    expect(reopenedTask.status).toBe("PENDING");
    // past the window
    expect(await store.actOnComplaint(c.id, { type: "resolve", actorId: rm1, resolutionCode: "OK", resolution: "Fixed" }, { now: later })).toMatchObject({ ok: true });
    const far = new Date(later.getTime() + 40 * 86_400_000);
    expect(await store.actOnComplaint(c.id, { type: "reopen", actorId: rm1, reason: "again" }, { now: far })).toMatchObject({ ok: false, code: "REOPEN_WINDOW_PASSED" });
  });

  it("two people resolving at once: exactly one wins", async () => {
    const r = await store.registerComplaint({ clientId: c1, title: "Race", severity: "LOW", source: { type: "INSIGHT", ref: insightC1 }, actorId: rm1, now: NOW });
    if (!r.ok) throw new Error("setup");
    const [a, b] = await Promise.all([
      store.actOnComplaint(r.complaintId, { type: "resolve", actorId: rm1, resolutionCode: "A", resolution: "by a" }, { now: NOW }),
      store.actOnComplaint(r.complaintId, { type: "resolve", actorId: mgr, resolutionCode: "B", resolution: "by b" }, { now: NOW }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect((await db.complaintEvent.count({ where: { complaintId: r.complaintId, type: "resolved" } }))).toBe(1);
  });

  it("the audit chain carries ids and states, never the title or the ticket text", async () => {
    const audits = await db.auditLog.findMany({ where: { entity: { in: ["Complaint", "Commitment"] } } });
    expect(audits.length).toBeGreaterThan(3);
    const text = JSON.stringify(audits, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("Delayed withdrawal");
    expect(text).not.toContain("Paid out");
  });

  it("suggested commitments from insights: no invented deadline, and never overdue until a person accepts", async () => {
    const s = await store.suggestCommitmentsFromInsights(c1);
    expect(s).toMatchObject({ created: 1, skippedNoDueDate: 1 });
    expect(await store.suggestCommitmentsFromInsights(c1)).toMatchObject({ created: 0 }); // idempotent
    const row = await db.commitment.findFirstOrThrow({ where: { clientId: c1, insightId: commitInsight } });
    expect(row).toMatchObject({ confirmedAt: null, status: "OPEN", sourceType: "INSIGHT" });
    const facts = await read.getServiceFacts(c1, NOW);
    expect(facts.overdueCommitmentCount).toBe(0);
    expect((await read.getServiceQueue({ userId: rm1, role: "RM" }, NOW))!.commitments).toEqual([]);
    expect(await store.actOnCommitment(row.id, { type: "keep", actorId: rm1 }, { now: NOW })).toMatchObject({ ok: false, code: "BAD_STATE" }); // accept first
    expect(await store.acceptSuggestedCommitment(row.id, "system")).toMatchObject({ ok: false });
    expect(await store.acceptSuggestedCommitment(row.id, rm1, NOW)).toMatchObject({ ok: true });
    expect((await read.getServiceFacts(c1, NOW)).overdueCommitmentCount).toBe(1);
    expect((await read.getServiceQueue({ userId: rm1, role: "RM" }, NOW))!.commitments).toHaveLength(1);
  });

  it("a person records a promise: confirmed, with a task; overdue is derived; keep closes the task", async () => {
    const r = await store.registerCommitment({ clientId: c2, text: "Send the contract note", dueAt: h(-10), promisedByType: "RM", promisedById: rm2, actorId: rm2, now: NOW });
    if (!r.ok) throw new Error("setup");
    const row = await db.commitment.findUniqueOrThrow({ where: { id: r.commitmentId } });
    expect(row).toMatchObject({ status: "OPEN", confirmedById: rm2, ownerId: rm2 });
    expect((await read.getServiceFacts(c2, NOW)).overdueCommitmentCount).toBe(1);
    expect(await store.actOnCommitment(row.id, { type: "break", actorId: rm2, note: "" }, { now: NOW })).toMatchObject({ ok: false, code: "NOTE_REQUIRED" });
    expect(await store.actOnCommitment(row.id, { type: "keep", actorId: rm2 }, { now: NOW })).toMatchObject({ ok: true, status: "KEPT" });
    expect((await db.task.findUniqueOrThrow({ where: { id: row.taskId! } })).status).toBe("DONE");
    expect((await read.getServiceFacts(c2, NOW)).overdueCommitmentCount).toBe(0);
  });

  describe("scope: the queue and the strip follow the record scope, for every role", () => {
    beforeAll(async () => {
      for (const clientId of [c1, c2]) await store.registerComplaint({ clientId, title: "Scope probe", severity: "MEDIUM", source: { type: "MANUAL" }, actorId: admin, now: NOW });
    });
    const cases: [string, () => { userId: string; role: string }, string[] | null][] = [
      ["RM1 (own customer only)", () => ({ userId: rm1, role: "RM" }), ["SVC-0001"]],
      ["RM2 (own customer only)", () => ({ userId: rm2, role: "RM" }), ["SVC-0002"]],
      ["MANAGER of RM1 (the team)", () => ({ userId: mgr, role: "MANAGER" }), ["SVC-0001"]],
      ["ADMIN (everyone)", () => ({ userId: admin, role: "ADMIN" }), ["SVC-0001", "SVC-0002"]],
      ["MARKETING (nothing, not even an empty list)", () => ({ userId: mkt, role: "MARKETING" }), null],
      ["FINANCE", () => ({ userId: rm1, role: "FINANCE" }), null],
      ["PARTNER", () => ({ userId: rm1, role: "PARTNER" }), null],
    ];
    it.each(cases)("%s", async (_n, who, expected) => {
      const q = await read.getServiceQueue(who(), NOW);
      if (expected === null) { expect(q).toBeNull(); return; }
      const codes = [...new Set(q!.complaints.map((c) => c.clientCode))];
      expect(codes.sort()).toEqual(expected);
    });
    it("the strip: RM2 cannot read RM1's customer, MARKETING cannot read any", async () => {
      expect(await read.getServiceState({ userId: rm2, role: "RM" }, c1, NOW)).toBeNull();
      expect(await read.getServiceState({ userId: mkt, role: "MARKETING" }, c1, NOW)).toBeNull();
      expect(await read.getServiceState({ userId: rm1, role: "RM" }, c1, NOW)).not.toBeNull();
    });
    it("guarded actions answer 'not found' to someone outside the scope, and change nothing", async () => {
      const c = await db.complaint.findFirstOrThrow({ where: { clientId: c1 } });
      expect(await svc.actOnComplaintAs({ userId: rm2, role: "RM" }, c.id, { type: "set_severity", severity: "CRITICAL" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
      expect(await svc.registerComplaintAs({ userId: mkt, role: "MARKETING" }, { clientId: c1, title: "x", severity: "LOW", source: { type: "MANUAL" } })).toMatchObject({ ok: false, code: "NOT_FOUND" });
      expect((await db.complaint.findUniqueOrThrow({ where: { id: c.id } })).severity).not.toBe("CRITICAL");
    });
  });
});

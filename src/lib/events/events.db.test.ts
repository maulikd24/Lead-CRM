/**
 * Real-database checks of the event bus: idempotent emit (including concurrent callers), the transactional outbox (event and domain row commit or
 * roll back together, and an event failure never aborts the caller's transaction), late events, dead letters and consumer cursors.
 * Skipped unless EVENTS_DB_TEST=1 and DATABASE_URL is a local wt_ scratch database. Run it on its own (it shares the database):
 *   EVENTS_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<wt_w1a_scratch> npx vitest run src/lib/events/events.db.test.ts
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.EVENTS_DB_TEST === "1" && local && /\/wt_[a-z0-9_]+$/.test(url);

describe.skipIf(!enabled)("customer events (real database)", { timeout: 60_000 }, () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let prisma: typeof import("@/lib/db/prisma").prisma;
  let emit: typeof import("./emit-db");
  let stageId = "";
  const made: string[] = [];

  const mkClient = async (code: string) => {
    const c = await db.client.create({ data: { clientCode: code, name: "Event Probe", currentStageId: stageId } });
    made.push(c.id);
    return c;
  };
  const created = (clientId: string, key = `crm.web:${clientId}:lead.created`) => ({
    type: "lead.created", actor: { type: "system" as const }, clientId, source: "crm.web", dedupeKey: key, metadata: { ref: { table: "Client", id: clientId }, leadSource: "web" },
  });

  beforeAll(async () => {
    ({ basePrisma: db, prisma } = await import("@/lib/db/prisma"));
    emit = await import("./emit-db");
    stageId = ((await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "Events test stage", sequence: 9101, slaHours: 24 } }))).id;
    await db.customerEvent.deleteMany({});
    await db.eventEmitFailure.deleteMany({});
    const stale = (await db.client.findMany({ where: { clientCode: { startsWith: "EV-" } }, select: { id: true } })).map((c) => c.id);
    await db.activity.deleteMany({ where: { clientId: { in: stale } } });
    await db.client.deleteMany({ where: { id: { in: stale } } });
  });
  afterEach(() => { delete process.env.CUSTOMER_EVENTS_ENABLED; });
  afterAll(async () => {
    await db.eventDeadLetter.deleteMany({});
    await db.customerEvent.deleteMany({});
    await db.eventEmitFailure.deleteMany({});
    await db.eventCursor.deleteMany({});
    await db.activity.deleteMany({ where: { clientId: { in: made } } });
    await db.client.deleteMany({ where: { id: { in: made } } });
  });

  it("flag off: nothing is written, no matter how the caller emits", async () => {
    const c = await mkClient("EV-OFF");
    expect(await emit.emitEvent(created(c.id))).toEqual({ status: "disabled" });
    await prisma.$transaction(async (tx) => { expect(await emit.emitEventInTx(tx, created(c.id))).toEqual({ status: "disabled" }); });
    expect(await db.customerEvent.count({ where: { clientId: c.id } })).toBe(0);
  });

  it("idempotent: the same dedupe key emitted twice, and by five concurrent callers, stores exactly one row", async () => {
    process.env.CUSTOMER_EVENTS_ENABLED = "1";
    const c = await mkClient("EV-IDEM");
    const first = await emit.emitEvent(created(c.id));
    expect(first.status).toBe("stored");
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => emit.emitEvent(created(c.id))));
    expect(results.every((r) => r.status === "duplicate")).toBe(true);
    const fresh = await Promise.all([1, 2, 3, 4, 5].map(() => emit.emitEvent(created(c.id, "crm.web:concurrent:lead.created"))));
    expect(fresh.filter((r) => r.status === "stored")).toHaveLength(1);
    expect(await db.customerEvent.count({ where: { clientId: c.id } })).toBe(2);
    const row = await db.customerEvent.findFirstOrThrow({ where: { clientId: c.id, dedupeKey: `crm.web:${c.id}:lead.created` } });
    expect(row).toMatchObject({ eventType: "lead.created", schemaVersion: 1, dataClass: "PERSONAL", late: false });
    expect(row.correlationId).toBe(row.eventId);
  });

  it("transactional outbox: the event commits with the domain row", async () => {
    process.env.CUSTOMER_EVENTS_ENABLED = "1";
    let id = "";
    await prisma.$transaction(async (tx) => {
      const c = await tx.client.create({ data: { clientCode: "EV-TX-OK", name: "Event Probe", currentStageId: stageId } });
      id = c.id;
      made.push(id);
      expect((await emit.emitEventInTx(tx, created(id))).status).toBe("stored");
    });
    expect(await db.customerEvent.count({ where: { clientId: id } })).toBe(1);
  });

  it("transactional outbox: when the domain transaction rolls back, the event rolls back with it", async () => {
    process.env.CUSTOMER_EVENTS_ENABLED = "1";
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.client.create({ data: { clientCode: "EV-TX-RB", name: "Event Probe", currentStageId: stageId, id: "ev-rollback-client" } });
        await emit.emitEventInTx(tx, created("ev-rollback-client"));
        throw new Error("domain failure after the event");
      }),
    ).rejects.toThrow("domain failure");
    expect(await db.client.count({ where: { id: "ev-rollback-client" } })).toBe(0);
    expect(await db.customerEvent.count({ where: { clientId: "ev-rollback-client" } })).toBe(0);
  });

  it("a database error while storing the event does NOT abort the caller's transaction: the domain row still commits and the failure is recorded", async () => {
    process.env.CUSTOMER_EVENTS_ENABLED = "1";
    let id = "";
    let status = "";
    await prisma.$transaction(async (tx) => {
      const c = await tx.client.create({ data: { clientCode: "EV-TX-ERR", name: "Event Probe", currentStageId: stageId } });
      id = c.id;
      made.push(id);
      // A NUL character is valid for zod and invalid for Postgres jsonb: a genuine database error inside the transaction.
      const out = await emit.emitEventInTx(tx, { ...created(id), metadata: { ref: { table: "Client", id }, leadSource: "web\u0000x" } });
      status = out.status;
      // The transaction must still be usable after the failed insert.
      await tx.activity.create({ data: { clientId: id, type: "NOTE", payload: { message: "still writable" } } });
    });
    expect(status).toBe("failed");
    expect(await db.client.count({ where: { id } })).toBe(1);
    expect(await db.activity.count({ where: { clientId: id } })).toBe(1);
    expect(await db.customerEvent.count({ where: { clientId: id } })).toBe(0);
    expect(await db.eventEmitFailure.count({ where: { clientId: id, reason: "DB_ERROR" } })).toBe(1);
  });

  it("an invalid emit is rejected and recorded, and a transaction around it is untouched", async () => {
    process.env.CUSTOMER_EVENTS_ENABLED = "1";
    const c = await mkClient("EV-BAD");
    await prisma.$transaction(async (tx) => {
      expect(await emit.emitEventInTx(tx, { ...created(c.id), type: "lead.invented" })).toMatchObject({ status: "rejected" });
      await tx.activity.create({ data: { clientId: c.id, type: "NOTE", payload: { message: "ok" } } });
    });
    expect(await db.eventEmitFailure.count({ where: { clientId: c.id, reason: "UNREGISTERED" } })).toBe(1);
    expect(await db.activity.count({ where: { clientId: c.id } })).toBe(1);
  });

  it("late events are stored, flagged and ordered by occurred_at, not by receipt", async () => {
    process.env.CUSTOMER_EVENTS_ENABLED = "1";
    const c = await mkClient("EV-LATE");
    const old = new Date(Date.now() - 45 * 86_400_000);
    const recent = new Date(Date.now() - 3_600_000);
    await emit.emitEvent({ ...created(c.id, "k-new"), type: "lead.assigned", metadata: {}, occurredAt: recent });
    await emit.emitEvent({ ...created(c.id, "k-old"), type: "lead.assigned", metadata: {}, occurredAt: old });
    const rows = await db.customerEvent.findMany({ where: { clientId: c.id }, orderBy: { occurredAt: "desc" } });
    expect(rows.map((r) => r.dedupeKey)).toEqual(["k-new", "k-old"]);
    expect(rows.map((r) => r.late)).toEqual([false, true]);
    // received later than occurred, yet received order is the opposite of occurred order
    expect(rows[1].receivedAt.getTime()).toBeGreaterThanOrEqual(rows[0].receivedAt.getTime());
  });

  it("seq is monotonic so a consumer cursor can follow it", async () => {
    process.env.CUSTOMER_EVENTS_ENABLED = "1";
    const c = await mkClient("EV-SEQ");
    for (const k of ["a", "b", "c"]) await emit.emitEvent({ ...created(c.id, `seq-${k}`), type: "lead.contacted", metadata: {} });
    const rows = await db.customerEvent.findMany({ where: { clientId: c.id }, orderBy: { seq: "asc" } });
    expect(rows.map((r) => r.dedupeKey)).toEqual(["seq-a", "seq-b", "seq-c"]);
    expect(rows[2].seq > rows[0].seq).toBe(true);
  });
});

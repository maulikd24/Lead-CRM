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

  describe("consumers", () => {
    let consumers: typeof import("./consumers-db");
    let core: typeof import("./consumers");
    const opts = { now: () => new Date(), settleMs: 0, batchSize: 100, budgetMs: 10_000, maxAttempts: 2 };
    beforeAll(async () => { consumers = await import("./consumers-db"); core = await import("./consumers"); });
    const row = (clientId: string, dedupeKey: string, over: Record<string, unknown> = {}) =>
      db.customerEvent.create({ data: { eventId: `00000000-0000-4000-8000-${String(Math.abs(hash(dedupeKey))).padStart(12, "0").slice(0, 12)}`, eventType: "lead.created", occurredAt: new Date(), actorType: "system", clientId, source: "test", correlationId: "c", schemaVersion: 1, dataClass: "PERSONAL", dedupeKey, metadata: {}, ...over } });
    const hash = (x: string) => [...x].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);

    it("a cursor persists and delivers each event once; dead letters, retry and lag work against real rows", async () => {
      await db.customerEvent.deleteMany({});
      await db.eventCursor.deleteMany({});
      const c = await mkClient("EV-CONS");
      const a = await row(c.id, "cons-a");
      const bad = await row(c.id, "cons-bad", { eventType: "lead.not_registered" });
      const z = await row(c.id, "cons-z");

      const seen: string[] = [];
      let failBad = true;
      const handler = { name: "probe", sideEffects: "none" as const, async handle(e: { dedupeKey: string }) { if (e.dedupeKey === "cons-bad" && failBad) throw new Error("nope"); seen.push(e.dedupeKey); } };
      const store = consumers.consumerStore;

      let r = await core.runConsumer(handler, store, opts);
      expect(r).toMatchObject({ processed: 1, failed: 1 });
      expect(seen).toEqual(["cons-a"]);
      r = await core.runConsumer(handler, store, opts);
      expect(r).toMatchObject({ deadLettered: 1 });
      const dead = await db.eventDeadLetter.findFirstOrThrow({ where: { consumer: "probe" } });
      expect(dead).toMatchObject({ attempts: 2, status: "DEAD", eventId: bad.id, errorClass: "Error" });
      expect(dead.errorMessage).toBeNull();
      expect(seen).toEqual(["cons-a", "cons-z"]);
      expect((await db.eventCursor.findUniqueOrThrow({ where: { consumer: "probe" } })).lastSeq).toBe(z.seq);
      expect(await core.lagOf(store, "probe", new Date())).toEqual({ pending: 0, lagSeconds: 0 });

      // a second run delivers nothing again
      seen.length = 0;
      await core.runConsumer(handler, store, opts);
      expect(seen).toEqual([]);

      // Retry from the control plane: the handler is fixed, the dead letter resolves
      failBad = false;
      expect(await core.retryDeadLetter([handler], store, dead.id, opts)).toEqual({ ok: true });
      expect(await db.eventDeadLetter.findUniqueOrThrow({ where: { id: dead.id } })).toMatchObject({ status: "RESOLVED" });
      expect(seen).toEqual(["cons-bad"]);
      expect(a.seq < z.seq).toBe(true);
    });

    it("the audit consumer dead-letters an event of a type this build does not know and passes the rest", async () => {
      await db.customerEvent.deleteMany({});
      await db.eventCursor.deleteMany({});
      const c = await mkClient("EV-AUD");
      await row(c.id, "aud-ok");
      await row(c.id, "aud-bad", { eventType: "lead.not_registered" });
      const { auditConsumer } = await import("./audit-consumer");
      await core.runConsumer(auditConsumer, consumers.consumerStore, { ...opts, maxAttempts: 1 });
      expect(await db.eventDeadLetter.count({ where: { consumer: "audit", status: "DEAD" } })).toBe(1);
      expect((await db.eventCursor.findUniqueOrThrow({ where: { consumer: "audit" } })).processedTotal).toBe(1);
    });

    it("replay: resetting the cursor re-delivers every event to a safe consumer and an outbound consumer refuses", async () => {
      await db.eventCursor.deleteMany({});
      let n = 0;
      const safe = { name: "replay-safe", sideEffects: "none" as const, async handle() { n += 1; } };
      const sender = { name: "replay-sender", sideEffects: "outbound" as const, async handle() { throw new Error("must never run"); } };
      await core.runConsumer(safe, consumers.consumerStore, opts);
      const first = n;
      expect(first).toBeGreaterThan(0);
      await consumers.resetCursor("replay-safe");
      await core.runConsumer(safe, consumers.consumerStore, { ...opts, replay: true });
      expect(n).toBe(first * 2);
      expect(await core.runConsumer(sender, consumers.consumerStore, { ...opts, replay: true })).toMatchObject({ refused: "replay", processed: 0 });
    });

    it("the job is a no-op with the flag off and reports counts with it on", async () => {
      await db.eventCursor.deleteMany({});
      expect(await consumers.runEventConsumers({ settleMs: 0 })).toEqual({ skipped: true });
      process.env.CUSTOMER_EVENTS_ENABLED = "1";
      const out = await consumers.runEventConsumers({ settleMs: 0 });
      expect(out.consumers).toBeGreaterThanOrEqual(1);
      expect(typeof out.processed).toBe("number");
    });

    it("lag reports the age of the oldest waiting event", async () => {
      await db.customerEvent.deleteMany({});
      const c = await mkClient("EV-LAG");
      await row(c.id, "lag-1", { receivedAt: new Date(Date.now() - 20 * 60_000) });
      const lag = await core.lagOf(consumers.consumerStore, "never-ran", new Date());
      expect(lag.pending).toBe(1);
      expect(lag.lagSeconds).toBeGreaterThanOrEqual(20 * 60 - 5);
    });
  });
});

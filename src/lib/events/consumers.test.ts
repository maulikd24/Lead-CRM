import { describe, expect, it } from "vitest";

import { lagOf, retryDeadLetter, runConsumer, type ConsumerStore, type DeadLetterState, type EventConsumer } from "./consumers";
import type { StoredEvent } from "./envelope";

const T0 = new Date("2027-02-01T10:00:00Z");
let seq = 0;
const ev = (over: Partial<StoredEvent> = {}): StoredEvent => {
  seq += 1;
  return {
    id: `row${seq}`, seq: BigInt(seq), eventId: `e${seq}`, eventType: "lead.created", occurredAt: new Date(T0.getTime() - 60_000), receivedAt: new Date(T0.getTime() - 5 * 60_000 + seq * 1000), actorType: "system", actorId: null,
    clientId: "c1", source: "crm.web", correlationId: `e${seq}`, causationId: null, schemaVersion: 1, consentContext: null, metadata: {}, dataClass: "PERSONAL", dedupeKey: `k${seq}`, late: false, clockSkew: false, ...over,
  };
};

function memoryStore(events: StoredEvent[]) {
  const cursors = new Map<string, { lastSeq: bigint; processedTotal: number; lastError: string | null }>();
  const letters = new Map<string, DeadLetterState>();
  const store: ConsumerStore = {
    async getCursor(name) { return cursors.get(name) ?? null; },
    async readBatch(afterSeq, limit, settledBefore) { return events.filter((e) => e.seq > afterSeq && e.receivedAt <= settledBefore).sort((a, b) => Number(a.seq - b.seq)).slice(0, limit); },
    async saveCursor(name, state) { const prev = cursors.get(name); cursors.set(name, { lastSeq: state.lastSeq, processedTotal: (prev?.processedTotal ?? 0) + state.processed, lastError: state.lastError ?? null }); },
    async recordFailure(name, event, error, maxAttempts) {
      const key = `${event.id}|${name}`;
      const prev = letters.get(key);
      const attempts = (prev?.attempts ?? 0) + 1;
      const status = attempts >= maxAttempts ? "DEAD" : "RETRYING";
      letters.set(key, { eventId: event.id, consumer: name, attempts, status, errorClass: error });
      return { attempts, status };
    },
    async resolveFailure(name, event) { const l = letters.get(`${event.id}|${name}`); if (l) l.status = "RESOLVED"; },
    async pending(afterSeq) { const p = events.filter((e) => e.seq > afterSeq); return { count: p.length, oldestReceivedAt: p.length ? p.reduce((m, e) => (e.receivedAt < m ? e.receivedAt : m), p[0].receivedAt) : null }; },
    async loadDeadLetter(id) { return [...letters.values()].find((l) => `${l.eventId}|${l.consumer}` === id) ? { letter: [...letters.values()].find((l) => `${l.eventId}|${l.consumer}` === id)!, event: events.find((e) => id.startsWith(`${e.id}|`))! } : null; },
  };
  return { store, cursors, letters };
}
const opts = (over = {}) => ({ now: () => T0, settleMs: 0, batchSize: 50, budgetMs: 5000, maxAttempts: 3, ...over });
const consumer = (handle: EventConsumer["handle"], over: Partial<EventConsumer> = {}): EventConsumer => ({ name: "test", sideEffects: "none", handle, ...over });

describe("runConsumer: cursor and at-least-once delivery", () => {
  it("hands every event to the handler in seq order, advances the cursor and counts them", async () => {
    const events = [ev(), ev(), ev()];
    const { store, cursors } = memoryStore(events);
    const seen: string[] = [];
    const out = await runConsumer(consumer(async (e) => { seen.push(e.eventId); }), store, opts());
    expect(seen).toEqual(events.map((e) => e.eventId));
    expect(out).toMatchObject({ processed: 3, failed: 0, deadLettered: 0 });
    expect(cursors.get("test")!.lastSeq).toBe(events[2].seq);
  });
  it("a second run delivers nothing again (the cursor is the memory)", async () => {
    const { store } = memoryStore([ev(), ev()]);
    let n = 0;
    const c = consumer(async () => { n += 1; });
    await runConsumer(c, store, opts());
    const again = await runConsumer(c, store, opts());
    expect(n).toBe(2);
    expect(again.processed).toBe(0);
  });
  it("new events after the cursor are picked up on the next run", async () => {
    const events = [ev()];
    const { store } = memoryStore(events);
    let n = 0;
    const c = consumer(async () => { n += 1; });
    await runConsumer(c, store, opts());
    events.push(ev());
    await runConsumer(c, store, opts());
    expect(n).toBe(2);
  });
  it("events that have not settled yet are not read (a transaction that commits late can never be skipped by the cursor)", async () => {
    const fresh = ev({ receivedAt: new Date(T0.getTime() - 5_000) });
    const { store } = memoryStore([fresh]);
    const out = await runConsumer(consumer(async () => {}), store, opts({ settleMs: 60_000 }));
    expect(out.processed).toBe(0);
  });
  it("only events of the types the consumer asks for are handed over; the cursor still moves past the others", async () => {
    const events = [ev({ eventType: "lead.created" }), ev({ eventType: "call.logged" }), ev({ eventType: "lead.assigned" })];
    const { store, cursors } = memoryStore(events);
    const seen: string[] = [];
    const out = await runConsumer(consumer(async (e) => { seen.push(e.eventType); }, { types: ["lead.*"] }), store, opts());
    expect(seen).toEqual(["lead.created", "lead.assigned"]);
    expect(out).toMatchObject({ processed: 2, skipped: 1 });
    expect(cursors.get("test")!.lastSeq).toBe(events[2].seq);
  });
  it("stops at the time budget and resumes from the cursor next run", async () => {
    const events = [ev(), ev(), ev(), ev()];
    const { store, cursors } = memoryStore(events);
    let clock = 0;
    const out = await runConsumer(consumer(async () => { clock += 600; }), store, opts({ budgetMs: 1000, clock: () => clock }));
    expect(out.stoppedEarly).toBe(true);
    expect(out.processed).toBeLessThan(4);
    expect(cursors.get("test")!.lastSeq).toBe(events[out.processed - 1].seq);
  });
});

describe("runConsumer: failures and dead letters", () => {
  it("a failing handler stops the consumer on that event (order is kept), does not advance past it, and counts the attempt", async () => {
    const events = [ev(), ev(), ev()];
    const { store, cursors, letters } = memoryStore(events);
    const out = await runConsumer(consumer(async (e) => { if (e.eventId === events[1].eventId) throw new Error("boom postgresql://u:p@h/db"); }), store, opts());
    expect(out).toMatchObject({ processed: 1, failed: 1, deadLettered: 0 });
    expect(cursors.get("test")!.lastSeq).toBe(events[0].seq);
    expect([...letters.values()][0]).toMatchObject({ attempts: 1, status: "RETRYING" });
  });
  it("after N failed attempts the event moves to the dead letter list and the cursor goes past it (nothing is dropped silently, nothing blocks forever)", async () => {
    const events = [ev(), ev(), ev()];
    const { store, cursors, letters } = memoryStore(events);
    const c = consumer(async (e) => { if (e.eventId === events[1].eventId) throw new Error("always"); });
    await runConsumer(c, store, opts());
    await runConsumer(c, store, opts());
    const third = await runConsumer(c, store, opts());
    expect(third.deadLettered).toBe(1);
    expect([...letters.values()][0]).toMatchObject({ attempts: 3, status: "DEAD" });
    expect(cursors.get("test")!.lastSeq).toBe(events[2].seq);
  });
  it("an event that failed once and then succeeds is marked resolved", async () => {
    const events = [ev()];
    const { store, letters } = memoryStore(events);
    let calls = 0;
    const c = consumer(async () => { calls += 1; if (calls === 1) throw new Error("flaky"); });
    await runConsumer(c, store, opts());
    await runConsumer(c, store, opts());
    expect([...letters.values()][0].status).toBe("RESOLVED");
  });
  it("the stored error is the class only, never the message of the failure", async () => {
    const { store, letters } = memoryStore([ev()]);
    await runConsumer(consumer(async () => { throw new TypeError("secret 9876543210 detail"); }), store, opts());
    expect([...letters.values()][0].errorClass).toBe("TypeError");
  });
  it("retrying a dead letter re-runs the handler once: success resolves it, failure keeps it dead", async () => {
    const events = [ev()];
    const { store, letters } = memoryStore(events);
    const failing = consumer(async () => { throw new Error("x"); });
    for (let i = 0; i < 3; i++) await runConsumer(failing, store, opts());
    const id = `${events[0].id}|test`;
    expect([...letters.values()][0].status).toBe("DEAD");
    expect(await retryDeadLetter([failing], store, id, opts())).toMatchObject({ ok: false });
    expect([...letters.values()][0].status).toBe("DEAD");
    const fixed = consumer(async () => {});
    expect(await retryDeadLetter([fixed], store, id, opts())).toMatchObject({ ok: true });
    expect([...letters.values()][0].status).toBe("RESOLVED");
  });
});

describe("runConsumer: replay and late events never send", () => {
  it("a consumer that can send refuses to run in replay mode", async () => {
    const { store } = memoryStore([ev()]);
    let n = 0;
    const out = await runConsumer(consumer(async () => { n += 1; }, { sideEffects: "outbound" }), store, opts({ replay: true }));
    expect(out).toMatchObject({ refused: "replay" });
    expect(n).toBe(0);
  });
  it("a side-effect free consumer replays and is told so", async () => {
    const { store } = memoryStore([ev()]);
    let replay: boolean | undefined;
    await runConsumer(consumer(async (_e, ctx) => { replay = ctx.replay; }), store, opts({ replay: true }));
    expect(replay).toBe(true);
  });
  it("a consumer that can send never receives a late event (late events trigger no nudges)", async () => {
    const { store } = memoryStore([ev({ late: true }), ev({ late: false })]);
    const seen: boolean[] = [];
    const out = await runConsumer(consumer(async (e) => { seen.push(e.late); }, { sideEffects: "outbound" }), store, opts());
    expect(seen).toEqual([false]);
    expect(out.skipped).toBe(1);
  });
  it("a late event still reaches a consumer that has no side effects", async () => {
    const { store } = memoryStore([ev({ late: true })]);
    let n = 0;
    await runConsumer(consumer(async () => { n += 1; }), store, opts());
    expect(n).toBe(1);
  });
});

describe("lagOf", () => {
  it("is zero when nothing is waiting", async () => {
    const { store } = memoryStore([]);
    expect(await lagOf(store, "test", T0)).toEqual({ pending: 0, lagSeconds: 0 });
  });
  it("is the age of the oldest event after the cursor", async () => {
    const events = [ev({ receivedAt: new Date(T0.getTime() - 600_000) }), ev()];
    const { store } = memoryStore(events);
    const lag = await lagOf(store, "test", T0);
    expect(lag.pending).toBe(2);
    expect(lag.lagSeconds).toBe(600);
  });
});

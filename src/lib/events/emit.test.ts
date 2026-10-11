import { describe, expect, it } from "vitest";
import { z } from "zod";

import { DEFAULT_LATE_HORIZON_MS, dedupeKeyOf, eventIdFor, type EmitInput } from "./envelope";
import { emitWith, readEvent, type EmitFailureRow, type EventStore, type NewEventRow } from "./emit";
import type { EventDef } from "./registry";

function fakeStore(opts: { failInsert?: boolean; failRecord?: boolean } = {}) {
  const rows = new Map<string, NewEventRow>();
  const failures: EmitFailureRow[] = [];
  const store: EventStore = {
    async insert(row) {
      if (opts.failInsert) throw new Error("connection terminated postgresql://u:pw@db/x");
      const k = `${row.source}|${row.dedupeKey}`;
      if (rows.has(k)) return "duplicate";
      rows.set(k, row);
      return "inserted";
    },
    async recordFailure(f) {
      if (opts.failRecord) throw new Error("failure table missing");
      failures.push(f);
    },
  };
  return { store, rows, failures };
}

const NOW = new Date("2027-02-01T10:00:00Z");
const deps = (store: EventStore, extra: Partial<Parameters<typeof emitWith>[0]> = {}) => ({ store, enabled: () => true, now: () => NOW, ...extra });
const base = (over: Partial<EmitInput> = {}): EmitInput => ({
  type: "lead.created",
  actor: { type: "system", id: null },
  clientId: "c1",
  source: "crm.web",
  dedupeKey: dedupeKeyOf("crm.web", "c1", "lead.created"),
  metadata: { ref: { table: "Client", id: "c1" }, leadSource: "web" },
  ...over,
});

describe("emitWith: the flag", () => {
  it("does nothing and touches no store when the events flag is off", async () => {
    const { store, rows } = fakeStore();
    const out = await emitWith(deps(store, { enabled: () => false }), base());
    expect(out).toEqual({ status: "disabled" });
    expect(rows.size).toBe(0);
  });
});

describe("emitWith: the stored envelope", () => {
  it("fills the canonical envelope: deterministic event id, received_at from the clock, version and classification from the registry", async () => {
    const { store, rows } = fakeStore();
    const out = await emitWith(deps(store), base({ occurredAt: new Date("2027-02-01T09:00:00Z") }));
    expect(out.status).toBe("stored");
    const row = [...rows.values()][0];
    expect(row.eventId).toBe(eventIdFor("crm.web", "crm.web:c1:lead.created"));
    expect(row).toMatchObject({ eventType: "lead.created", clientId: "c1", source: "crm.web", schemaVersion: 1, dataClass: "PERSONAL", actorType: "system", late: false, clockSkew: false });
    expect(row.receivedAt).toEqual(NOW);
    expect(row.occurredAt).toEqual(new Date("2027-02-01T09:00:00Z"));
    if (out.status === "stored") expect(out.eventId).toBe(row.eventId);
  });
  it("a flow root correlates to itself; a supplied correlation and causation id are kept", async () => {
    const { store, rows } = fakeStore();
    await emitWith(deps(store), base());
    const root = [...rows.values()][0];
    expect(root.correlationId).toBe(root.eventId);
    expect(root.causationId).toBeNull();
    const corr = "11111111-1111-4111-8111-111111111111";
    const cause = "22222222-2222-4222-8222-222222222222";
    await emitWith(deps(store), base({ type: "lead.assigned", dedupeKey: "k2", correlationId: corr, causationId: cause, metadata: {} }));
    const second = [...rows.values()][1];
    expect(second.correlationId).toBe(corr);
    expect(second.causationId).toBe(cause);
  });
  it("occurred_at defaults to the receive time", async () => {
    const { store, rows } = fakeStore();
    await emitWith(deps(store), base());
    expect([...rows.values()][0].occurredAt).toEqual(NOW);
  });
  it("strips metadata keys the registry does not name, so free text cannot be stored by accident", async () => {
    const { store, rows } = fakeStore();
    await emitWith(deps(store), base({ metadata: { ref: { table: "Client", id: "c1" }, leadSource: "web", note: "call 9876543210", email: "a@b.test" } }));
    expect(JSON.stringify([...rows.values()][0].metadata)).not.toMatch(/9876543210|a@b\.test/);
  });
});

describe("emitWith: idempotency", () => {
  it("the same dedupe key stores once; the second call reports a duplicate with the same event id", async () => {
    const { store, rows } = fakeStore();
    const a = await emitWith(deps(store), base());
    const b = await emitWith(deps(store), base());
    expect(rows.size).toBe(1);
    expect(a.status).toBe("stored");
    expect(b.status).toBe("duplicate");
    expect(b).toMatchObject({ eventId: (a as { eventId: string }).eventId });
  });
  it("the same dedupe key from a different source is a different fact", async () => {
    const { store, rows } = fakeStore();
    await emitWith(deps(store), base());
    await emitWith(deps(store), base({ source: "crm.cron" }));
    expect(rows.size).toBe(2);
  });
});

describe("emitWith: validation never throws into the caller", () => {
  it("an unregistered type is rejected and recorded, not thrown", async () => {
    const { store, rows, failures } = fakeStore();
    const out = await emitWith(deps(store), base({ type: "lead.invented" }));
    expect(out).toMatchObject({ status: "rejected", reason: "UNREGISTERED" });
    expect(rows.size).toBe(0);
    expect(failures[0]).toMatchObject({ eventType: "lead.invented", reason: "UNREGISTERED" });
  });
  it("invalid metadata is rejected and recorded", async () => {
    const { store, failures } = fakeStore();
    const out = await emitWith(deps(store), base({ type: "call.logged", dedupeKey: "k", metadata: { durationSeconds: "long" } }));
    expect(out).toMatchObject({ status: "rejected", reason: "INVALID" });
    expect(failures[0].reason).toBe("INVALID");
  });
  it("an event about a person without a customer id is rejected", async () => {
    const { store } = fakeStore();
    expect(await emitWith(deps(store), base({ clientId: null }))).toMatchObject({ status: "rejected", reason: "INVALID" });
  });
  it("a system fact may have no customer", async () => {
    const { store, rows } = fakeStore();
    const out = await emitWith(deps(store), base({ type: "campaign.spend.synced", clientId: null, dedupeKey: "meta:day1", metadata: { provider: "meta" } }));
    expect(out.status).toBe("stored");
    expect([...rows.values()][0].clientId).toBeNull();
  });
  it("a bad envelope (no dedupe key, bad source) is rejected, never thrown", async () => {
    const { store } = fakeStore();
    expect((await emitWith(deps(store), base({ dedupeKey: "" }))).status).toBe("rejected");
    expect((await emitWith(deps(store), base({ source: "BAD SOURCE" }))).status).toBe("rejected");
  });
});

describe("emitWith: late events, skew and consent", () => {
  it("an event older than the horizon at receipt is stored but flagged late", async () => {
    const { store, rows } = fakeStore();
    const out = await emitWith(deps(store), base({ occurredAt: new Date(NOW.getTime() - DEFAULT_LATE_HORIZON_MS - 60_000) }));
    expect(out.status).toBe("stored");
    expect([...rows.values()][0].late).toBe(true);
  });
  it("a late event that is just inside the horizon is not late", async () => {
    const { store, rows } = fakeStore();
    await emitWith(deps(store), base({ occurredAt: new Date(NOW.getTime() - 3 * 86_400_000) }));
    expect([...rows.values()][0].late).toBe(false);
  });
  it("occurred_at ahead of the receive clock is flagged as skew", async () => {
    const { store, rows } = fakeStore();
    await emitWith(deps(store), base({ occurredAt: new Date(NOW.getTime() + 3_600_000) }));
    expect([...rows.values()][0].clockSkew).toBe(true);
  });
  it("an event that needs consent but has none is stored and counted, never dropped", async () => {
    const { store, rows } = fakeStore();
    const out = await emitWith(deps(store), base({ type: "whatsapp.message.sent", dedupeKey: "m1", metadata: { channel: "whatsapp" } }));
    expect(out).toMatchObject({ status: "stored", missingConsent: true });
    expect(rows.size).toBe(1);
  });
  it("keeps the consent snapshot when it is supplied", async () => {
    const { store, rows } = fakeStore();
    const out = await emitWith(deps(store), base({ type: "whatsapp.message.sent", dedupeKey: "m1", metadata: {}, consentContext: { purpose: "SERVICE_COMMS", status: "GRANTED", ledgerId: "l1", noticeVersion: "v2" } }));
    expect(out).toMatchObject({ status: "stored", missingConsent: false });
    expect([...rows.values()][0].consentContext).toMatchObject({ purpose: "SERVICE_COMMS", ledgerId: "l1" });
  });
});

describe("emitWith: failures of the store", () => {
  it("a store error is swallowed: the caller gets a status, never an exception, and the failure is recorded with a scrubbed message", async () => {
    const { store, failures } = fakeStore({ failInsert: true });
    const out = await emitWith(deps(store), base());
    expect(out).toMatchObject({ status: "failed" });
    expect(failures[0]).toMatchObject({ reason: "DB_ERROR", eventType: "lead.created", dedupeKey: "crm.web:c1:lead.created" });
    expect(failures[0].detail ?? "").not.toMatch(/postgresql:\/\/|pw@/);
  });
  it("even when the failure record cannot be written the caller is not affected", async () => {
    const { store } = fakeStore({ failInsert: true, failRecord: true });
    await expect(emitWith(deps(store), base())).resolves.toMatchObject({ status: "failed" });
  });
  it("personal metadata is not copied into a failure record; internal metadata is, so it can be replayed", async () => {
    const personal = fakeStore({ failInsert: true });
    await emitWith(deps(personal.store), base());
    expect(personal.failures[0].envelope?.metadata).toBeUndefined();
    const internal = fakeStore({ failInsert: true });
    await emitWith(deps(internal.store), base({ type: "campaign.spend.synced", clientId: null, dedupeKey: "d", metadata: { provider: "meta" } }));
    expect(internal.failures[0].envelope?.metadata).toEqual({ provider: "meta" });
  });
});

describe("readEvent: schema versioning (readers handle N and N-1)", () => {
  const v1 = z.object({ a: z.string() });
  const v2 = z.object({ a: z.string(), b: z.number().default(0) });
  const def: EventDef = { type: "lead.created", description: "", currentVersion: 2, schemas: { 1: v1 as never, 2: v2 as never }, upcast: { 1: (m: Record<string, unknown>) => ({ ...m, b: 0 }) }, dataClass: "INTERNAL", customerRequired: true, consentRequired: false, mirrors: null };
  const lookup = (t: string) => (t === "lead.created" ? def : undefined);
  const row = (version: number, metadata: unknown) => ({ eventType: "lead.created", schemaVersion: version, metadata });

  it("reads the current version as is", () => expect(readEvent(row(2, { a: "x", b: 3 }), lookup)).toEqual({ ok: true, version: 2, data: { a: "x", b: 3 } }));
  it("reads the previous version through its upcaster", () => expect(readEvent(row(1, { a: "x" }), lookup)).toEqual({ ok: true, version: 1, data: { a: "x", b: 0 } }));
  it("refuses a version this build does not know, without throwing", () => expect(readEvent(row(9, { a: "x" }), lookup)).toMatchObject({ ok: false, reason: "unknown_version" }));
  it("refuses an unregistered type", () => expect(readEvent({ eventType: "lead.nope", schemaVersion: 1, metadata: {} }, lookup)).toMatchObject({ ok: false, reason: "unregistered" }));
  it("reports metadata that no longer matches its schema", () => expect(readEvent(row(2, { a: 5 }), lookup)).toMatchObject({ ok: false, reason: "invalid" }));
  it("an erased event (metadata nulled) reads as erased, not as an error", () => expect(readEvent(row(2, null), lookup)).toMatchObject({ ok: true, data: {} }));
});

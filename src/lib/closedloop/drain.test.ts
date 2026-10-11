import { beforeEach, describe, expect, it } from "vitest";

import type { ConsentRow } from "@/lib/consent/decision";
import { FakeDestination } from "./fake-destination";
import { backoffMs, drainOutbox, MAX_ATTEMPTS, type DrainDeps } from "./drain";
import type { DestinationSettings } from "./gate";
import { MemoryOutbox } from "./memory-store";
import type { NewOutboxRow } from "./types";

const NOW = new Date("2027-03-20T10:00:00Z");
const GOOD: DestinationSettings = { enabled: true, region: "global", allowedRegions: ["global"], sendValue: false };
const grant = (at = "2027-01-01"): ConsentRow => ({ id: `g${at}`, purpose: "ADS_MEASUREMENT", channel: null, status: "GRANTED", capturedAt: new Date(at) });
const withdraw = (at: string): ConsentRow => ({ id: `w${at}`, purpose: "ADS_MEASUREMENT", channel: null, status: "WITHDRAWN", capturedAt: new Date(at) });

let n = 0;
const ev = (o: Partial<NewOutboxRow> = {}): NewOutboxRow => ({
  clientId: "c1", destination: "fake", eventType: "KYC_COMPLETE", qualifier: "", dedupId: `d${++n}`, occurredAt: new Date("2027-03-19T10:00:00Z"),
  identity: { hashedEmail: "aa".repeat(32) }, value: null, ...o,
});

let store: MemoryOutbox;
let dest: FakeDestination;
let consent: Map<string, ConsentRow[]>;
let kill: boolean;
let settings: DestinationSettings;
const deps = (over: Partial<DrainDeps> = {}): DrainDeps => ({
  store,
  destinations: async () => new Map([["fake", { destination: dest, settings }]]),
  loadConsent: async (ids) => new Map(ids.map((id) => [id, consent.get(id) ?? []])),
  killSwitch: () => kill,
  now: () => NOW,
  maxPerRun: 100,
  ...over,
});

beforeEach(() => {
  n = 0;
  store = new MemoryOutbox();
  dest = new FakeDestination();
  consent = new Map([["c1", [grant()]]]);
  kill = false;
  settings = { ...GOOD };
});

describe("drainOutbox: the happy path", () => {
  it("sends a due row once and marks it SENT with the platform's match answer", async () => {
    await store.insertIfAbsent(ev(), NOW);
    const r = await drainOutbox(deps());
    expect(r).toMatchObject({ sent: 1, retried: 0, dead: 0, skipped: 0 });
    expect(store.rows[0]).toMatchObject({ status: "SENT", matched: true, attempts: 1, sentAt: NOW });
    expect(dest.received).toHaveLength(1);
  });
  it("is idempotent: a second drain sends nothing more, and a re-produced dedup id is not queued twice", async () => {
    const row = ev();
    await store.insertIfAbsent(row, NOW);
    expect((await store.insertIfAbsent(row, NOW)).created).toBe(false);
    await drainOutbox(deps());
    await drainOutbox(deps());
    expect(dest.received).toHaveLength(1);
    expect(dest.calls).toBe(1);
  });
  it("passes the destination only what it needs: no client id, no raw personal data", async () => {
    await store.insertIfAbsent(ev({ value: 120000 }), NOW);
    await drainOutbox(deps());
    expect(Object.keys(dest.received[0]).sort()).toEqual(["dedupId", "eventType", "identity", "occurredAt", "qualifier", "value"]);
  });
});

describe("drainOutbox: the consent gate at send time", () => {
  it("never sends after a withdrawal: the row is skipped with the reason", async () => {
    await store.insertIfAbsent(ev(), NOW);
    consent.set("c1", [grant(), withdraw("2027-03-19T12:00:00Z")]);
    const r = await drainOutbox(deps());
    expect(r.skipped).toBe(1);
    expect(store.rows[0]).toMatchObject({ status: "SKIPPED", reason: "CONSENT_WITHDRAWN" });
    expect(dest.calls).toBe(0);
  });
  it("never sends for a customer with no consent row", async () => {
    consent.set("c1", []);
    await store.insertIfAbsent(ev(), NOW);
    await drainOutbox(deps());
    expect(store.rows[0]).toMatchObject({ status: "SKIPPED", reason: "CONSENT_MISSING" });
    expect(dest.calls).toBe(0);
  });
  it("one withdrawn customer does not hold up a consented one in the same run", async () => {
    consent.set("c2", [grant(), withdraw("2027-03-19T12:00:00Z")]);
    await store.insertIfAbsent(ev({ clientId: "c2" }), NOW);
    await store.insertIfAbsent(ev({ clientId: "c1" }), NOW);
    const r = await drainOutbox(deps());
    expect(r).toMatchObject({ sent: 1, skipped: 1 });
    expect(dest.received).toHaveLength(1);
  });
});

describe("drainOutbox: kill switch, destination and region", () => {
  it("the kill switch holds every row untouched", async () => {
    await store.insertIfAbsent(ev(), NOW);
    kill = true;
    const r = await drainOutbox(deps());
    expect(r.held).toEqual({ KILL_SWITCH: 1 });
    expect(store.rows[0]).toMatchObject({ status: "PENDING", attempts: 0 });
    expect(dest.calls).toBe(0);
    kill = false;
    expect((await drainOutbox(deps())).sent).toBe(1);
  });
  it("a region that has not been approved holds rows; so does a destination that is off or missing", async () => {
    await store.insertIfAbsent(ev(), NOW);
    settings = { ...GOOD, allowedRegions: [] };
    expect((await drainOutbox(deps())).held).toEqual({ REGION_BLOCKED: 1 });
    settings = { ...GOOD, enabled: false };
    expect((await drainOutbox(deps())).held).toEqual({ DESTINATION_OFF: 1 });
    expect((await drainOutbox(deps({ destinations: async () => new Map() }))).held).toEqual({ DESTINATION_OFF: 1 });
    expect(dest.calls).toBe(0);
    expect(store.rows[0].status).toBe("PENDING");
  });
  it("an event older than the platform accepts is skipped, not sent", async () => {
    await store.insertIfAbsent(ev({ occurredAt: new Date("2027-03-01T00:00:00Z") }), NOW);
    await drainOutbox(deps());
    expect(store.rows[0]).toMatchObject({ status: "SKIPPED", reason: "TOO_OLD" });
  });
});

describe("drainOutbox: retry with backoff and the dead-letter list", () => {
  it("backoff grows and is capped", () => {
    expect(backoffMs(1)).toBe(5 * 60_000);
    expect(backoffMs(2)).toBe(15 * 60_000);
    expect(backoffMs(3)).toBeGreaterThan(backoffMs(2));
    expect(backoffMs(50)).toBe(12 * 3_600_000);
  });
  it("a retryable failure schedules the next try and does not send before it", async () => {
    await store.insertIfAbsent(ev(), NOW);
    dest.failAll = { errorCode: "http_500" };
    expect((await drainOutbox(deps())).retried).toBe(1);
    expect(store.rows[0]).toMatchObject({ status: "FAILED", attempts: 1, lastError: "http_500" });
    expect(store.rows[0].nextAttemptAt).toEqual(new Date(NOW.getTime() + backoffMs(1)));
    expect((await drainOutbox(deps())).sent).toBe(0); // not due yet
    expect(dest.calls).toBe(1);
    dest.failAll = null;
    const later = new Date(NOW.getTime() + backoffMs(1) + 1);
    expect((await drainOutbox(deps({ now: () => later }))).sent).toBe(1);
    expect(store.rows[0]).toMatchObject({ status: "SENT", attempts: 2 });
  });
  it("after the last attempt the row is dead-lettered", async () => {
    await store.insertIfAbsent(ev(), NOW);
    dest.failAll = { errorCode: "http_500" };
    let t = NOW;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await drainOutbox(deps({ now: () => t }));
      t = new Date(t.getTime() + 13 * 3_600_000);
    }
    expect(store.rows[0]).toMatchObject({ status: "DEAD", attempts: MAX_ATTEMPTS });
  });
  it("a platform rejection is dead at once (retrying cannot help)", async () => {
    const row = ev();
    await store.insertIfAbsent(row, NOW);
    dest.script.set(row.dedupId, { outcome: "rejected", errorCode: "invalid_parameter" });
    expect((await drainOutbox(deps())).dead).toBe(1);
    expect(store.rows[0]).toMatchObject({ status: "DEAD", lastError: "invalid_parameter" });
  });
  it("a thrown send is a retry with a generic code, never the error text", async () => {
    await store.insertIfAbsent(ev(), NOW);
    dest.throwOnSend = true;
    await drainOutbox(deps());
    expect(store.rows[0]).toMatchObject({ status: "FAILED", lastError: "network_error" });
  });
  it("an admin retry puts a dead row back and it can send", async () => {
    const row = ev();
    await store.insertIfAbsent(row, NOW);
    dest.script.set(row.dedupId, { outcome: "rejected", errorCode: "invalid_parameter" });
    await drainOutbox(deps());
    dest.script.clear();
    expect(await store.requeue(store.rows[0].id, NOW)).toBe(true);
    expect((await drainOutbox(deps())).sent).toBe(1);
  });
  it("a platform's retry-after stops that destination for this run", async () => {
    await store.insertIfAbsent(ev({ clientId: "c1" }), NOW);
    await store.insertIfAbsent(ev({ clientId: "c1" }), NOW);
    dest.maxBatch = 1;
    dest.failAll = { errorCode: "http_429", retryAfterMs: 3_600_000 * 2 };
    const r = await drainOutbox(deps());
    expect(dest.calls).toBe(1);
    expect(r.rateLimited).toBe(true);
    expect(store.rows.find((x) => x.status === "FAILED")!.nextAttemptAt!.getTime()).toBe(NOW.getTime() + 2 * 3_600_000);
  });
});

describe("drainOutbox: rate limiting and batching", () => {
  it("sends at most maxPerRun per destination per run, in batches the destination accepts", async () => {
    for (let i = 0; i < 7; i++) await store.insertIfAbsent(ev(), NOW);
    dest.maxBatch = 3;
    const r = await drainOutbox(deps({ maxPerRun: 5 }));
    expect(r.sent).toBe(5);
    expect(dest.calls).toBe(2);
    expect(store.rows.filter((x) => x.status === "PENDING")).toHaveLength(2);
  });
});

describe("drainOutbox: crashes", () => {
  it("a row stuck SENDING after a crash is reclaimed once its claim is stale, and not before", async () => {
    await store.insertIfAbsent(ev(), NOW);
    await store.claim(store.rows[0].id, new Date(NOW.getTime() - 60_000), new Date(0));
    expect((await drainOutbox(deps())).sent).toBe(0);
    const later = new Date(NOW.getTime() + 11 * 60_000);
    expect((await drainOutbox(deps({ now: () => later }))).sent).toBe(1);
  });
});

describe("drainOutbox: results as events", () => {
  it("reports a sent row and a dead row (once each, with codes only) and never lets a failing reporter break the run", async () => {
    await store.insertIfAbsent(ev({ dedupId: "ok" }), NOW);
    await store.insertIfAbsent(ev({ dedupId: "bad" }), NOW);
    dest.script.set("bad", { outcome: "rejected", errorCode: "invalid_params" });
    const seen: { kind: string; dedupId: string; code?: string; matched?: boolean | null }[] = [];
    const r = await drainOutbox(deps({ onResult: async (row, res) => { seen.push({ kind: res.kind, dedupId: row.dedupId, code: res.kind === "failed" ? res.errorCode : undefined, matched: res.kind === "sent" ? res.matched : undefined }); } }));
    expect(r).toMatchObject({ sent: 1, dead: 1 });
    expect(seen.sort((a, b) => a.dedupId.localeCompare(b.dedupId))).toEqual([{ kind: "failed", dedupId: "bad", code: "invalid_params", matched: undefined }, { kind: "sent", dedupId: "ok", code: undefined, matched: true }]);
    const boom = await drainOutbox(deps({ onResult: async () => { throw new Error("event store down"); } }));
    expect(boom.considered).toBe(0);
    await store.insertIfAbsent(ev({ dedupId: "later" }), NOW);
    const ok = await drainOutbox(deps({ onResult: async () => { throw new Error("event store down"); } }));
    expect(ok.sent).toBe(1);
    expect(store.rows.find((x) => x.dedupId === "later")!.status).toBe("SENT");
  });
  it("a retry is not reported as a failure (only the terminal state is)", async () => {
    await store.insertIfAbsent(ev(), NOW);
    dest.failAll = { errorCode: "http_500" };
    const seen: string[] = [];
    await drainOutbox(deps({ onResult: async (_r, res) => void seen.push(res.kind) }));
    expect(seen).toEqual([]);
  });
});

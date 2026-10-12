import { describe, expect, it } from "vitest";
import { createMemoryStore } from "./memory-store";
import { hashNotice, recordConsent, ConsentInputError } from "./ledger";
import { consentDecision, currentStates } from "./decision";

const NOW = new Date("2026-10-09T10:00:00Z");
const base = { clientId: "c1", purpose: "MARKETING_COMMS", channel: null, source: "RM_RECORDED", capturedById: "u1", reason: "Customer said yes on a call" } as const;

describe("recordConsent", () => {
  it("appends a GRANTED row with a text hash and defaults capturedAt to now", async () => {
    const store = createMemoryStore();
    const row = await recordConsent(store, { ...base, status: "GRANTED", noticeVersion: "v2", noticeText: "I agree to receive offers" }, NOW);
    expect(row).toMatchObject({ clientId: "c1", purpose: "MARKETING_COMMS", status: "GRANTED", noticeVersion: "v2", capturedAt: NOW });
    expect(row.noticeTextHash).toBe(hashNotice("I agree to receive offers"));
    expect(row.noticeTextHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain("I agree to receive offers");
  });

  it("is append-only: a withdrawal adds a row, nothing is edited or removed, and the store has no update/delete", async () => {
    const store = createMemoryStore();
    const first = await recordConsent(store, { ...base, status: "GRANTED" }, new Date("2026-09-01T00:00:00Z"));
    const snapshot = JSON.stringify(first);
    await recordConsent(store, { ...base, status: "WITHDRAWN", reason: "Asked to stop" }, NOW);
    const all = await store.listForClient("c1");
    expect(all).toHaveLength(2);
    expect(JSON.stringify(all.find((r) => r.id === first.id))).toBe(snapshot);
    expect(Object.keys(store).sort()).toEqual(["append", "listForClient", "listForClients"]);
  });

  it("current state is the latest row per client+purpose+channel", async () => {
    const store = createMemoryStore();
    await recordConsent(store, { ...base, status: "GRANTED" }, new Date("2026-09-01T00:00:00Z"));
    await recordConsent(store, { ...base, status: "WITHDRAWN" }, new Date("2026-09-15T00:00:00Z"));
    await recordConsent(store, { ...base, channel: "sms", status: "GRANTED" }, new Date("2026-09-16T00:00:00Z"));
    const states = currentStates(await store.listForClient("c1"));
    expect(states.map((s) => `${s.channel ?? "all"}:${s.status}`).sort()).toEqual(["all:WITHDRAWN", "sms:GRANTED"]);
    expect(consentDecision(await store.listForClient("c1"), "MARKETING_COMMS", "whatsapp", NOW).allowed).toBe(false);
  });

  it("keeps clients apart", async () => {
    const store = createMemoryStore();
    await recordConsent(store, { ...base, status: "GRANTED" }, NOW);
    expect(await store.listForClient("c2")).toEqual([]);
  });

  it("requires a reason when an RM records it by hand", async () => {
    const store = createMemoryStore();
    await expect(recordConsent(store, { ...base, status: "GRANTED", reason: "" }, NOW)).rejects.toThrow(ConsentInputError);
    await expect(recordConsent(store, { ...base, status: "GRANTED", reason: "  ab " }, NOW)).rejects.toThrow(/reason/);
    expect(await store.listForClient("c1")).toHaveLength(0);
  });

  it("does not need a reason for system sources, but still validates the vocabulary", async () => {
    const store = createMemoryStore();
    await recordConsent(store, { clientId: "c1", purpose: "MARKETING_COMMS", channel: "whatsapp", status: "WITHDRAWN", source: "WHATSAPP_KEYWORD", evidenceRef: "msg:abc" }, NOW);
    await expect(recordConsent(store, { ...base, status: "GRANTED", purpose: "NOPE" }, NOW)).rejects.toThrow(/purpose/);
    await expect(recordConsent(store, { ...base, status: "MAYBE" }, NOW)).rejects.toThrow(/status/);
    await expect(recordConsent(store, { ...base, status: "GRANTED", source: "TELEPATHY" }, NOW)).rejects.toThrow(/source/);
    await expect(recordConsent(store, { ...base, channel: "pigeon", status: "GRANTED" }, NOW)).rejects.toThrow(/channel/);
    expect(await store.listForClient("c1")).toHaveLength(1);
  });

  it("rejects a capture time in the future and drops expiry on a withdrawal", async () => {
    const store = createMemoryStore();
    await expect(recordConsent(store, { ...base, status: "GRANTED", capturedAt: new Date("2026-10-20T00:00:00Z") }, NOW)).rejects.toThrow(/future/);
    const w = await recordConsent(store, { ...base, status: "WITHDRAWN", expiresAt: new Date("2027-01-01") }, NOW);
    expect(w.expiresAt).toBeNull();
  });

  it("truncates long free text and keeps the evidence reference", async () => {
    const store = createMemoryStore();
    const row = await recordConsent(store, { ...base, status: "GRANTED", reason: "x".repeat(2000), evidenceRef: "recording:" + "y".repeat(500) }, NOW);
    expect(row.reason!.length).toBeLessThanOrEqual(500);
    expect(row.evidenceRef!.length).toBeLessThanOrEqual(200);
  });
});

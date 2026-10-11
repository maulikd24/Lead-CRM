import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConsentRow } from "@/lib/consent/decision";
import type { StoredEvent } from "@/lib/events/envelope";

import { closedLoopIntakeConsumer, CLOSED_LOOP_CONSUMER, INTAKE_TYPES } from "./intake";
import { FakeDestination } from "./fake-destination";
import type { DestinationSettings } from "./gate";
import { MemoryOutbox } from "./memory-store";
import { produceOutbox, type Candidate, type ProduceDeps } from "./produce";

const NOW = new Date("2027-03-20T10:00:00Z");
const GOOD: DestinationSettings = { enabled: true, region: "global", allowedRegions: ["global"], sendValue: false };
const grant = (): ConsentRow => ({ id: "g1", purpose: "ADS_MEASUREMENT", channel: null, status: "GRANTED", capturedAt: new Date("2027-01-01") });

const candidate = (clientId = "c1"): Candidate => ({
  facts: { clientId, kyc: { status: "APPROVED", completionDate: new Date("2027-03-19T08:00:00Z") }, funding: { status: "FULLY_FUNDED", fundingDate: new Date("2027-03-19T09:00:00Z"), amount: 123456 }, aum: null, aumAsOf: null },
  email: "asha@example.com", mobile: "+91 98765 43210", attribution: { gclid: "G1", fbclid: "F1" }, clientCreatedAt: new Date("2027-03-01T00:00:00Z"),
});

const event = (type: string, clientId: string | null = "c1", metadata: Record<string, unknown> = {}): StoredEvent => ({
  id: "e1", seq: 1n, eventId: "00000000-0000-4000-8000-000000000001", eventType: type, occurredAt: new Date("2027-03-19T08:00:00Z"), receivedAt: NOW, actorType: "system", actorId: null, clientId,
  source: "crm.web", correlationId: "00000000-0000-4000-8000-0000000000aa", causationId: null, schemaVersion: 1, consentContext: null, metadata, dataClass: "SENSITIVE_PERSONAL", dedupeKey: "k", late: false, clockSkew: false,
});
const CTX = { replay: false, now: NOW };

let store: MemoryOutbox;
let consent: Map<string, ConsentRow[]>;
const produceDeps = (candidates: Candidate[]): ProduceDeps => ({
  store,
  loadCandidates: async () => candidates,
  loadConsent: async (ids) => new Map(ids.map((id) => [id, consent.get(id) ?? []])),
  destinations: async () => new Map([["meta_capi", { destination: new FakeDestination("meta_capi"), settings: GOOD }]]),
  aumBands: () => null,
  now: () => NOW,
});
const snapshot = (s: MemoryOutbox) => s.rows.map((r) => ({ d: r.destination, e: r.eventType, dedup: r.dedupId, at: r.occurredAt.toISOString(), status: r.status, reason: r.reason, identity: r.identity, value: r.value })).sort((a, b) => a.dedup.localeCompare(b.dedup));

beforeEach(() => {
  store = new MemoryOutbox();
  consent = new Map([["c1", [grant()]]]);
});

describe("the closed-loop intake consumer", () => {
  it("listens to exactly the KYC-verified, funded and consent-withdrawn events, and has no outbound effect", () => {
    const c = closedLoopIntakeConsumer({ enabled: () => true, intakeFor: vi.fn(), cancelFor: vi.fn() });
    expect(c.name).toBe(CLOSED_LOOP_CONSUMER);
    expect([...(c.types ?? [])].sort()).toEqual(["account.funded", "account.kyc.verified", "customer.consent.withdrawn"]);
    expect([...INTAKE_TYPES].sort()).toEqual([...(c.types ?? [])].sort());
    expect(c.sideEffects).toBe("none");
  });

  it("does nothing while the module is off", async () => {
    const intakeFor = vi.fn();
    const cancelFor = vi.fn();
    await closedLoopIntakeConsumer({ enabled: () => false, intakeFor, cancelFor }).handle(event("account.funded"), CTX);
    expect(intakeFor).not.toHaveBeenCalled();
    expect(cancelFor).not.toHaveBeenCalled();
  });

  it("ignores an event with no customer", async () => {
    const intakeFor = vi.fn();
    await closedLoopIntakeConsumer({ enabled: () => true, intakeFor, cancelFor: vi.fn() }).handle(event("account.kyc.verified", null), CTX);
    expect(intakeFor).not.toHaveBeenCalled();
  });

  it("a KYC or funded event queues that customer's events", async () => {
    const intakeFor = vi.fn(async () => undefined);
    const c = closedLoopIntakeConsumer({ enabled: () => true, intakeFor, cancelFor: vi.fn() });
    await c.handle(event("account.kyc.verified", "c7"), CTX);
    await c.handle(event("account.funded", "c8"), CTX);
    expect(intakeFor.mock.calls.map((x) => x[0])).toEqual(["c7", "c8"]);
  });

  it("an ad-measurement withdrawal cancels unsent rows; a withdrawal of another purpose does not", async () => {
    const cancelFor = vi.fn(async () => 1);
    const c = closedLoopIntakeConsumer({ enabled: () => true, intakeFor: vi.fn(), cancelFor });
    await c.handle(event("customer.consent.withdrawn", "c1", { purpose: "MARKETING_COMMS" }), CTX);
    expect(cancelFor).not.toHaveBeenCalled();
    await c.handle(event("customer.consent.withdrawn", "c1", { purpose: "ADS_MEASUREMENT" }), CTX);
    expect(cancelFor).toHaveBeenCalledWith("c1");
  });
});

describe("dual path: the event path and the sweep produce the same rows", () => {
  it("the same customer and facts give identical outbox rows whichever path ran first, and running both adds nothing", async () => {
    const viaSweep = new MemoryOutbox();
    store = viaSweep;
    await produceOutbox(produceDeps([candidate()]));

    const viaEvent = new MemoryOutbox();
    store = viaEvent;
    const c = closedLoopIntakeConsumer({
      enabled: () => true,
      cancelFor: async () => 0,
      intakeFor: async (clientId) => void (await produceOutbox(produceDeps([candidate(clientId)]))),
    });
    await c.handle(event("account.kyc.verified"), CTX);
    expect(snapshot(viaEvent)).toEqual(snapshot(viaSweep));
    expect(viaEvent.rows).toHaveLength(2);

    await c.handle(event("account.funded"), CTX); // a second event for the same customer
    await produceOutbox(produceDeps([candidate()])); // and the sweep after it
    expect(snapshot(viaEvent)).toEqual(snapshot(viaSweep));
  });

  it("the event path is still gated by consent: no consent gives a skipped row, never a pending one", async () => {
    consent = new Map();
    const c = closedLoopIntakeConsumer({ enabled: () => true, cancelFor: async () => 0, intakeFor: async (id) => void (await produceOutbox(produceDeps([candidate(id)]))) });
    await c.handle(event("account.funded"), CTX);
    expect(store.rows.length).toBeGreaterThan(0);
    expect(store.rows.every((r) => r.status === "SKIPPED" && r.reason === "CONSENT_MISSING" && Object.keys(r.identity).length === 0)).toBe(true);
  });
});

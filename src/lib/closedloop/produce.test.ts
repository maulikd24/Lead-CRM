import { beforeEach, describe, expect, it } from "vitest";

import type { ConsentRow } from "@/lib/consent/decision";
import { FakeDestination } from "./fake-destination";
import { dedupIdFor, DEFAULT_AUM_BANDS } from "./events";
import type { DestinationSettings } from "./gate";
import { MemoryOutbox } from "./memory-store";
import { produceOutbox, type Candidate, type ProduceDeps } from "./produce";

const NOW = new Date("2027-03-20T10:00:00Z");
const GOOD: DestinationSettings = { enabled: true, region: "global", allowedRegions: ["global"], sendValue: false };
const row = (status: "GRANTED" | "WITHDRAWN", at: string): ConsentRow => ({ id: at + status, purpose: "ADS_MEASUREMENT", channel: null, status, capturedAt: new Date(at) });

const cand = (o: Partial<Candidate> & { clientId?: string } = {}): Candidate => ({
  facts: { clientId: o.clientId ?? "c1", kyc: { status: "APPROVED", completionDate: new Date("2027-03-19T08:00:00Z") }, funding: { status: "FULLY_FUNDED", fundingDate: new Date("2027-03-19T09:00:00Z"), amount: 123456 }, aum: null, aumAsOf: null, ...(o.facts ?? {}) },
  email: "Asha@Example.com", mobile: "+91 98765 43210", attribution: { gclid: "G1", fbclid: "F1" }, clientCreatedAt: new Date("2027-03-01T00:00:00Z"), ...o,
});

let store: MemoryOutbox;
let consent: Map<string, ConsentRow[]>;
let candidates: Candidate[];
let settings: DestinationSettings;
let meta: FakeDestination;
let google: FakeDestination;
const deps = (over: Partial<ProduceDeps> = {}): ProduceDeps => ({
  store,
  loadCandidates: async () => candidates,
  loadConsent: async (ids) => new Map(ids.map((id) => [id, consent.get(id) ?? []])),
  destinations: async () => new Map([["meta_capi", { destination: meta, settings }]]),
  aumBands: () => null,
  now: () => NOW,
  ...over,
});

beforeEach(() => {
  store = new MemoryOutbox();
  consent = new Map([["c1", [row("GRANTED", "2027-01-01")]]]);
  candidates = [cand()];
  settings = { ...GOOD };
  meta = new FakeDestination("meta_capi");
  google = new FakeDestination("google_ads");
  google.platform = "google";
});

describe("produceOutbox", () => {
  it("queues KYC complete and first funding for a consented customer, with stable dedup ids and hashed identity only", async () => {
    const r = await produceOutbox(deps());
    expect(r).toMatchObject({ queued: 2, skipped: 0 });
    const rows = store.rows;
    expect(rows.map((x) => x.eventType).sort()).toEqual(["FIRST_FUNDING", "KYC_COMPLETE"]);
    expect(rows.find((x) => x.eventType === "KYC_COMPLETE")!.dedupId).toBe(dedupIdFor("c1", "KYC_COMPLETE"));
    expect(rows.every((x) => x.status === "PENDING" && x.destination === "meta_capi")).toBe(true);
    const blob = JSON.stringify(rows.map((x) => x.identity));
    expect(blob).not.toMatch(/asha|example|9876543210/i);
    expect(rows[0].identity.hashedEmail).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].identity.fbc).toBeTruthy();
    expect(rows[0].identity.gclid).toBeUndefined(); // meta destination gets meta ids only
  });
  it("is idempotent: sweeping again changes nothing", async () => {
    await produceOutbox(deps());
    const again = await produceOutbox(deps());
    expect(again).toMatchObject({ queued: 0, skipped: 0 });
    expect(store.rows).toHaveLength(2);
  });
  it("never queues for a customer with no ad measurement consent, even if a loader hands one over", async () => {
    consent.set("c1", []);
    const r = await produceOutbox(deps());
    expect(r.queued).toBe(0);
    expect(store.rows.every((x) => x.status === "SKIPPED" && x.reason === "CONSENT_MISSING")).toBe(true);
  });
  it("judges consent at event time: consent given after the event does not cover it", async () => {
    consent.set("c1", [row("GRANTED", "2027-03-19T12:00:00Z")]); // after KYC (08:00) and funding (09:00)
    await produceOutbox(deps());
    expect(store.rows.every((x) => x.status === "SKIPPED" && x.reason === "CONSENT_MISSING")).toBe(true);
  });
  it("consent held at the event time but withdrawn since is not queued: it is skipped as withdrawn", async () => {
    consent.set("c1", [row("GRANTED", "2027-01-01"), row("WITHDRAWN", "2027-03-19T08:30:00Z")]);
    await produceOutbox(deps());
    const kyc = store.rows.find((x) => x.eventType === "KYC_COMPLETE")!;
    const funding = store.rows.find((x) => x.eventType === "FIRST_FUNDING")!;
    expect(kyc.status).toBe("PENDING"); // consent held at 08:00
    expect(funding).toMatchObject({ status: "SKIPPED", reason: "CONSENT_WITHDRAWN" }); // withdrawn before 09:00
  });
  it("skips with NO_IDENTIFIERS when there is nothing to match on", async () => {
    candidates = [cand({ email: null, mobile: null, attribution: null })];
    await produceOutbox(deps());
    expect(store.rows.every((x) => x.status === "SKIPPED" && x.reason === "NO_IDENTIFIERS")).toBe(true);
  });
  it("makes one row per enabled destination, each with that platform's identifiers; nothing for a disabled destination", async () => {
    await produceOutbox(deps({ destinations: async () => new Map([["meta_capi", { destination: meta, settings }], ["google_ads", { destination: google, settings }]]) }));
    expect(store.rows).toHaveLength(4);
    expect(store.rows.find((x) => x.destination === "google_ads")!.identity.gclid).toBe("G1");
    store.rows.length = 0;
    await produceOutbox(deps({ destinations: async () => new Map([["meta_capi", { destination: meta, settings: { ...settings, enabled: false } }]]) }));
    expect(store.rows).toHaveLength(0);
  });
  it("sends a rounded funding value only when the destination is set to", async () => {
    await produceOutbox(deps());
    expect(store.rows.find((x) => x.eventType === "FIRST_FUNDING")!.value).toBeNull();
    store.rows.length = 0;
    settings = { ...GOOD, sendValue: true };
    await produceOutbox(deps());
    expect(store.rows.find((x) => x.eventType === "FIRST_FUNDING")!.value).toBe(120000);
    expect(store.rows.find((x) => x.eventType === "KYC_COMPLETE")!.value).toBeNull();
  });
  it("AUM band events appear only when bands are configured", async () => {
    candidates = [cand({ facts: { clientId: "c1", kyc: null, funding: null, aum: 6_000_000, aumAsOf: new Date("2027-03-19T00:00:00Z") } })];
    await produceOutbox(deps());
    expect(store.rows).toHaveLength(0);
    await produceOutbox(deps({ aumBands: () => DEFAULT_AUM_BANDS }));
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ eventType: "AUM_BAND", qualifier: "50L" });
  });
  it("does nothing when no destination is enabled", async () => {
    expect(await produceOutbox(deps({ destinations: async () => new Map() }))).toMatchObject({ queued: 0, skipped: 0 });
    expect(store.rows).toHaveLength(0);
  });
});

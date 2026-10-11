import { describe, expect, it } from "vitest";

import { DEFAULT_AUM_BANDS, dedupIdFor, detectEvents, roundedValue, type ClientFacts } from "./events";

const T = (s: string) => new Date(s);
const base: ClientFacts = { clientId: "ckabc123", kyc: null, funding: null, aum: null, aumAsOf: null };

describe("dedupIdFor", () => {
  it("is stable, differs by type and band, and does not contain the client id", () => {
    const a = dedupIdFor("ckabc123", "KYC_COMPLETE");
    expect(dedupIdFor("ckabc123", "KYC_COMPLETE")).toBe(a);
    expect(dedupIdFor("ckabc123", "FIRST_FUNDING")).not.toBe(a);
    expect(dedupIdFor("ckother", "KYC_COMPLETE")).not.toBe(a);
    expect(dedupIdFor("ckabc123", "AUM_BAND", "10L")).not.toBe(dedupIdFor("ckabc123", "AUM_BAND", "50L"));
    expect(a).toMatch(/^cl1_[0-9a-f]{32}$/);
    expect(a).not.toContain("ckabc123");
  });
});

describe("detectEvents", () => {
  it("nothing for a customer with no KYC or funding record", () => {
    expect(detectEvents(base, { aumBands: null })).toEqual([]);
  });
  it("KYC complete only when approved, at the completion time", () => {
    expect(detectEvents({ ...base, kyc: { status: "PENDING", completionDate: null } }, { aumBands: null })).toEqual([]);
    expect(detectEvents({ ...base, kyc: { status: "REJECTED", completionDate: T("2027-03-01") } }, { aumBands: null })).toEqual([]);
    const [e, ...rest] = detectEvents({ ...base, kyc: { status: "APPROVED", completionDate: T("2027-03-01T05:00:00Z") } }, { aumBands: null });
    expect(rest).toEqual([]);
    expect(e).toMatchObject({ type: "KYC_COMPLETE", occurredAt: T("2027-03-01T05:00:00Z"), qualifier: "" });
    expect(e.dedupId).toBe(dedupIdFor("ckabc123", "KYC_COMPLETE"));
  });
  it("approved with no completion date is not an event (we cannot say when)", () => {
    expect(detectEvents({ ...base, kyc: { status: "APPROVED", completionDate: null } }, { aumBands: null })).toEqual([]);
  });
  it("first funding for partially or fully funded, not for pending or not proceeding", () => {
    for (const status of ["PENDING", "NOT_PROCEEDING"]) expect(detectEvents({ ...base, funding: { status, fundingDate: T("2027-03-02"), amount: 100000 } }, { aumBands: null })).toEqual([]);
    for (const status of ["PARTIALLY_FUNDED", "FULLY_FUNDED"]) {
      const [e] = detectEvents({ ...base, funding: { status, fundingDate: T("2027-03-02"), amount: 123456 } }, { aumBands: null });
      expect(e).toMatchObject({ type: "FIRST_FUNDING", occurredAt: T("2027-03-02"), amount: 123456 });
    }
  });
  it("a customer who is both KYC complete and funded yields both events, in time order", () => {
    const events = detectEvents({ ...base, kyc: { status: "APPROVED", completionDate: T("2027-03-05") }, funding: { status: "FULLY_FUNDED", fundingDate: T("2027-03-02"), amount: 50000 } }, { aumBands: null });
    expect(events.map((e) => e.type)).toEqual(["FIRST_FUNDING", "KYC_COMPLETE"]);
  });
  it("AUM band: only when bands are configured, the highest band reached, with its own dedup id", () => {
    const facts = { ...base, aum: 6_000_000, aumAsOf: T("2027-03-10") };
    expect(detectEvents(facts, { aumBands: null })).toEqual([]);
    const [e] = detectEvents(facts, { aumBands: DEFAULT_AUM_BANDS });
    expect(e).toMatchObject({ type: "AUM_BAND", qualifier: "50L", occurredAt: T("2027-03-10") });
    expect(e.dedupId).toBe(dedupIdFor("ckabc123", "AUM_BAND", "50L"));
    expect(detectEvents({ ...facts, aum: 500_000 }, { aumBands: DEFAULT_AUM_BANDS })).toEqual([]);
  });
});

describe("roundedValue", () => {
  it("rounds to the nearest ten thousand rupees and drops non-positive or missing amounts", () => {
    expect(roundedValue(123456)).toBe(120000);
    expect(roundedValue(125000)).toBe(130000);
    expect(roundedValue(0)).toBeNull();
    expect(roundedValue(null)).toBeNull();
  });
});

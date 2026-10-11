import { describe, expect, it } from "vitest";

import { fundedAtOf, intakeTouch, revenueSummary } from "./rows";

const d = (iso: string) => new Date(iso);

describe("intakeTouch: a ledger row as a touch", () => {
  it("reads the attribution and lead source the intake normalised, and when it was received", () => {
    const row = { source: "google_ads", externalId: "G2", receivedAt: d("2027-03-10T05:00:00Z"), rawPayload: { raw: { junk: 1 }, normalized: { leadSource: "Google Ads", attribution: { gclid: "z", campaign_id: "g9" } } } };
    expect(intakeTouch(row)).toEqual({ source: "google_ads", externalId: "G2", at: d("2027-03-10T05:00:00Z"), leadSource: "Google Ads", attribution: { gclid: "z", campaign_id: "g9", source: "google_ads", externalId: "G2" } });
  });
  it("copes with a payload of any other shape (an erased tombstone, a failed row)", () => {
    for (const rawPayload of [null, "x", 4, [], { erased: true }, { normalized: null }, { normalized: { attribution: "str" } }]) {
      const t = intakeTouch({ source: "web", externalId: "W", receivedAt: d("2027-03-10T05:00:00Z"), rawPayload });
      expect(t.attribution === null || typeof t.attribution === "object").toBe(true);
      expect(t.leadSource).toBeNull();
    }
  });
});

describe("fundedAtOf: the first funding", () => {
  it("is the earliest successful funds-in payment, or the funding date of a funded record", () => {
    expect(fundedAtOf({ payments: [d("2027-03-09T00:00:00Z"), d("2027-03-07T00:00:00Z")], funding: null })).toEqual(d("2027-03-07T00:00:00Z"));
    expect(fundedAtOf({ payments: [], funding: { status: "FULLY_FUNDED", fundingDate: d("2027-03-08T00:00:00Z") } })).toEqual(d("2027-03-08T00:00:00Z"));
    expect(fundedAtOf({ payments: [d("2027-03-09T00:00:00Z")], funding: { status: "PARTIALLY_FUNDED", fundingDate: d("2027-03-08T00:00:00Z") } })).toEqual(d("2027-03-08T00:00:00Z"));
  });
  it("is null for pending or not-proceeding funding and for no payments", () => {
    expect(fundedAtOf({ payments: [], funding: { status: "PENDING", fundingDate: d("2027-03-08T00:00:00Z") } })).toBeNull();
    expect(fundedAtOf({ payments: [], funding: null })).toBeNull();
  });
  it("a funded record with no date counts as funded but has no date (never invented)", () => {
    expect(fundedAtOf({ payments: [], funding: { status: "FULLY_FUNDED", fundingDate: null } })).toBeNull();
  });
});

describe("revenueSummary: net revenue by type, as the marketing module counts it, with its first date", () => {
  it("counts brokerage and advisory fees, subtracts reversals, ignores trail commissions", () => {
    const s = revenueSummary([
      { id: "a", revenueType: "BROKERAGE", amount: 1000, eventDate: d("2027-04-01T00:00:00Z"), reversesEventId: null, reversedType: null },
      { id: "b", revenueType: "ADVISORY_FEE", amount: 500, eventDate: d("2027-03-20T00:00:00Z"), reversesEventId: null, reversedType: null },
      { id: "c", revenueType: "TRAIL_COMMISSION", amount: 9000, eventDate: d("2027-03-01T00:00:00Z"), reversesEventId: null, reversedType: null },
      { id: "r", revenueType: "BROKERAGE", amount: -200, eventDate: d("2027-04-05T00:00:00Z"), reversesEventId: "a", reversedType: "BROKERAGE" },
    ]);
    expect(s.total).toBe(1300);
    expect(s.firstAt).toEqual(d("2027-03-20T00:00:00Z"));
    expect(s.byMonth).toEqual({ "2027-03": 500, "2027-04": 800 });
  });
  it("nothing counted means zero and no date", () => {
    expect(revenueSummary([])).toEqual({ total: 0, firstAt: null, byMonth: {} });
  });
});

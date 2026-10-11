import { describe, expect, it } from "vitest";

import type { ConsentRow } from "@/lib/consent/decision";
import type { ClientFacts } from "./events";
import { explainCustomer, type ExplainerDestination } from "./explainer";
import type { DestinationSettings } from "./gate";

const NOW = new Date("2027-03-20T10:00:00Z");
const GOOD: DestinationSettings = { enabled: true, region: "global", allowedRegions: ["global"], sendValue: false };
const dest = (over: Partial<ExplainerDestination> = {}): ExplainerDestination => ({ key: "meta_capi", label: "Meta Conversions API", platform: "meta", settings: GOOD, ...over });
const grant: ConsentRow = { id: "g", purpose: "ADS_MEASUREMENT", channel: null, status: "GRANTED", capturedAt: new Date("2027-01-01") };
const facts: ClientFacts = { clientId: "c1", kyc: { status: "APPROVED", completionDate: new Date("2027-03-01") }, funding: null, aum: null, aumAsOf: null };
const base: Parameters<typeof explainCustomer>[0] = { rows: [grant], facts, email: "a@example.com", mobile: "9876543210", attribution: null, createdAt: new Date("2027-02-01"), destinations: [dest()], killSwitch: false, now: NOW, aumBands: null };

describe("explainCustomer", () => {
  it("says so when no destination is set up", () => {
    expect(explainCustomer({ ...base, destinations: [] })).toEqual({ kind: "no_destination" });
  });
  it("says so when the customer has no KYC or funding event yet", () => {
    expect(explainCustomer({ ...base, facts: { ...facts, kyc: null } })).toEqual({ kind: "no_event" });
  });
  it("one line per destination, sendable when every check passes", () => {
    const r = explainCustomer(base);
    expect(r).toMatchObject({ kind: "lines", events: ["KYC complete"] });
    if (r.kind === "lines") expect(r.lines).toEqual([{ destination: "Meta Conversions API", sendable: true, text: "Will be sent (or already was) once the next run picks it up." }]);
  });
  it("names the first blocker, in plain English, per destination", () => {
    const r = explainCustomer({ ...base, rows: [], destinations: [dest(), dest({ key: "google_ads", label: "Google Ads", platform: "google", settings: { ...GOOD, allowedRegions: [] } })] });
    if (r.kind !== "lines") throw new Error("expected lines");
    expect(r.lines.every((l) => !l.sendable)).toBe(true);
    expect(r.lines[0].text).toMatch(/consent/i);
  });
  it("no identifiers, a blocked region and the kill switch each have their own reason", () => {
    const only = (over: Partial<typeof base>) => { const r = explainCustomer({ ...base, ...over }); if (r.kind !== "lines") throw new Error("lines"); return r.lines[0].text; };
    expect(only({ email: null, mobile: null })).toMatch(/no email, phone or ad click id/i);
    expect(only({ destinations: [dest({ settings: { ...GOOD, allowedRegions: [] } })] })).toMatch(/region/i);
    expect(only({ killSwitch: true })).toMatch(/kill switch/i);
  });
  it("judges consent at the time of the event: consent given after KYC does not cover it", () => {
    const late: ConsentRow = { ...grant, capturedAt: new Date("2027-03-10") };
    const r = explainCustomer({ ...base, rows: [late] });
    if (r.kind !== "lines") throw new Error("lines");
    expect(r.lines[0].sendable).toBe(false);
    expect(r.lines[0].text).toMatch(/consent/i);
  });
  it("is reasons only: the output never mentions money, spend, cost or campaigns, and carries no identifier", () => {
    const outputs = [explainCustomer(base), explainCustomer({ ...base, rows: [] }), explainCustomer({ ...base, killSwitch: true }), explainCustomer({ ...base, email: null, mobile: null })];
    const text = JSON.stringify(outputs);
    expect(text).not.toMatch(/spend|cost|₹|rupee|campaign|cpl|revenue|a@example|9876543210/i);
  });
});

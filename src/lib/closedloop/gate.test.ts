import { describe, expect, it } from "vitest";

import type { ConsentRow } from "@/lib/consent/decision";
import { adsConsentVerdict, destinationVerdict, explainWhyNotSent, regionVerdict, type DestinationSettings } from "./gate";

const NOW = new Date("2027-03-20T10:00:00Z");
const row = (status: "GRANTED" | "WITHDRAWN", at: string, o: Partial<ConsentRow> = {}): ConsentRow => ({ id: at + status, purpose: "ADS_MEASUREMENT", channel: null, status, capturedAt: new Date(at), ...o });
const GOOD: DestinationSettings = { enabled: true, region: "global", allowedRegions: ["global"], sendValue: false };

describe("adsConsentVerdict", () => {
  it("no record, withdrawn and expired are different reasons; a grant passes", () => {
    expect(adsConsentVerdict([], NOW)).toEqual({ ok: false, reason: "CONSENT_MISSING" });
    expect(adsConsentVerdict([row("GRANTED", "2027-01-01"), row("WITHDRAWN", "2027-02-01")], NOW)).toEqual({ ok: false, reason: "CONSENT_WITHDRAWN" });
    expect(adsConsentVerdict([row("GRANTED", "2026-01-01", { expiresAt: new Date("2027-01-01") })], NOW)).toEqual({ ok: false, reason: "CONSENT_EXPIRED" });
    expect(adsConsentVerdict([row("GRANTED", "2027-01-01")], NOW)).toEqual({ ok: true });
  });
  it("is judged at the instant given: a grant made after the event does not cover it; a withdrawal after the event does not undo it at that time", () => {
    const rows = [row("GRANTED", "2027-03-10"), row("WITHDRAWN", "2027-03-15")];
    expect(adsConsentVerdict(rows, new Date("2027-03-12"))).toEqual({ ok: true });
    expect(adsConsentVerdict(rows, new Date("2027-03-09"))).toEqual({ ok: false, reason: "CONSENT_MISSING" });
    expect(adsConsentVerdict(rows, new Date("2027-03-16"))).toEqual({ ok: false, reason: "CONSENT_WITHDRAWN" });
  });
  it("other purposes never count, and the legacy marketing tick is not ad consent", () => {
    expect(adsConsentVerdict([{ ...row("GRANTED", "2027-01-01"), purpose: "MARKETING_COMMS" }, { ...row("GRANTED", "2027-01-01"), purpose: "DATA_SHARING_PARTNERS" }], NOW)).toEqual({ ok: false, reason: "CONSENT_MISSING" });
  });
  it("record-only on the purpose cannot loosen it", () => {
    expect(adsConsentVerdict([], NOW, { CONSENT_RECORD_ONLY_PURPOSES: "ADS_MEASUREMENT" })).toEqual({ ok: false, reason: "CONSENT_MISSING" });
  });
});

describe("regionVerdict (default blocked until the owner confirms)", () => {
  it("blocks with no region, no allow-list, or a region not on the list", () => {
    expect(regionVerdict({ ...GOOD, allowedRegions: [] })).toEqual({ ok: false, reason: "REGION_BLOCKED" });
    expect(regionVerdict({ ...GOOD, region: null })).toEqual({ ok: false, reason: "REGION_BLOCKED" });
    expect(regionVerdict({ ...GOOD, region: "eu" })).toEqual({ ok: false, reason: "REGION_BLOCKED" });
  });
  it("passes when the region is on the list (case-insensitive)", () => {
    expect(regionVerdict({ ...GOOD, region: "IN", allowedRegions: ["in", "global"] })).toEqual({ ok: true });
  });
});

describe("destinationVerdict", () => {
  it("kill switch first, then off, then region", () => {
    expect(destinationVerdict(GOOD, { killSwitch: true })).toEqual({ ok: false, reason: "KILL_SWITCH" });
    expect(destinationVerdict({ ...GOOD, enabled: false }, { killSwitch: false })).toEqual({ ok: false, reason: "DESTINATION_OFF" });
    expect(destinationVerdict({ ...GOOD, allowedRegions: [] }, { killSwitch: false })).toEqual({ ok: false, reason: "REGION_BLOCKED" });
    expect(destinationVerdict(GOOD, { killSwitch: false })).toEqual({ ok: true });
  });
});

describe("explainWhyNotSent", () => {
  const rows = [row("GRANTED", "2027-01-01")];
  it("says sendable when everything holds", () => {
    expect(explainWhyNotSent({ rows, at: NOW, match: { hashedEmail: "x" }, destination: GOOD, killSwitch: false, erased: false })).toEqual({ sendable: true });
  });
  it("names the first reason, in a fixed order: erased, consent, identifiers, kill switch, destination, region", () => {
    const ok = { rows, at: NOW, match: { hashedEmail: "x" }, destination: GOOD, killSwitch: false, erased: false };
    expect(explainWhyNotSent({ ...ok, erased: true })).toMatchObject({ sendable: false, reason: "ERASED" });
    expect(explainWhyNotSent({ ...ok, rows: [] })).toMatchObject({ reason: "CONSENT_MISSING" });
    expect(explainWhyNotSent({ ...ok, rows: [row("GRANTED", "2027-01-01"), row("WITHDRAWN", "2027-02-01")] })).toMatchObject({ reason: "CONSENT_WITHDRAWN" });
    expect(explainWhyNotSent({ ...ok, match: {} })).toMatchObject({ reason: "NO_IDENTIFIERS" });
    expect(explainWhyNotSent({ ...ok, killSwitch: true })).toMatchObject({ reason: "KILL_SWITCH" });
    expect(explainWhyNotSent({ ...ok, destination: { ...GOOD, allowedRegions: [] } })).toMatchObject({ reason: "REGION_BLOCKED" });
  });
  it("gives plain-English text for every reason", () => {
    const r = explainWhyNotSent({ rows: [], at: NOW, match: {}, destination: GOOD, killSwitch: false, erased: false });
    expect(r.sendable).toBe(false);
    if (!r.sendable) expect(r.text).toMatch(/consent/i);
  });
});

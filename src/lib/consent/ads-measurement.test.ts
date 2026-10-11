import { describe, expect, it } from "vitest";

import { consentDecision, type ConsentRow } from "./decision";
import { adsGatePolicy, adsMeasurementNotice, ADS_MEASUREMENT_NOTICE_DEFAULT, CONSENT_POLICY, CONSENT_PURPOSES, resolvePolicy } from "./policy";
import { PURPOSE_LABEL } from "./view";

const NOW = new Date("2027-03-20T10:00:00Z");
const row = (o: Partial<ConsentRow> & Pick<ConsentRow, "status" | "capturedAt">): ConsentRow => ({ purpose: "ADS_MEASUREMENT", channel: null, id: Math.random().toString(36), ...o });

describe("ADS_MEASUREMENT purpose", () => {
  it("is a ledger purpose with its own label, required mode and no do-not-contact coupling", () => {
    expect(CONSENT_PURPOSES).toContain("ADS_MEASUREMENT");
    expect(PURPOSE_LABEL.ADS_MEASUREMENT).toBe("Ad measurement");
    expect(CONSENT_POLICY.ADS_MEASUREMENT).toMatchObject({ mode: "required", honoursDoNotContact: false });
    expect(CONSENT_POLICY.ADS_MEASUREMENT.summary).toMatch(/hashed/i);
  });
  it("needs an explicit grant: nothing on file, withdrawn and expired all deny", () => {
    expect(consentDecision([], "ADS_MEASUREMENT", null, NOW).allowed).toBe(false);
    expect(consentDecision([row({ status: "GRANTED", capturedAt: new Date("2027-01-01") }), row({ status: "WITHDRAWN", capturedAt: new Date("2027-02-01") })], "ADS_MEASUREMENT", null, NOW)).toMatchObject({ allowed: false, reason: "WITHDRAWN" });
    expect(consentDecision([row({ status: "GRANTED", capturedAt: new Date("2026-01-01"), expiresAt: new Date("2027-01-01") })], "ADS_MEASUREMENT", null, NOW)).toMatchObject({ allowed: false, reason: "EXPIRED" });
    expect(consentDecision([row({ status: "GRANTED", capturedAt: new Date("2027-01-01") })], "ADS_MEASUREMENT", null, NOW).allowed).toBe(true);
  });
  it("a do-not-contact flag does not stop measurement (it is not contact)", () => {
    const dnd: ConsentRow = { purpose: "DO_NOT_CONTACT", channel: null, status: "GRANTED", capturedAt: new Date("2027-02-01"), id: "d" };
    expect(consentDecision([row({ status: "GRANTED", capturedAt: new Date("2027-01-01") }), dnd], "ADS_MEASUREMENT", null, NOW).allowed).toBe(true);
  });
  it("can be switched to record only like any purpose, but the ad gate ignores that and stays strict", () => {
    const policy = resolvePolicy({ CONSENT_RECORD_ONLY_PURPOSES: "ADS_MEASUREMENT" });
    expect(policy.ADS_MEASUREMENT.mode).toBe("record_only");
    expect(consentDecision([], "ADS_MEASUREMENT", null, NOW, { policy })).toMatchObject({ allowed: true, reason: "RECORD_ONLY", wouldBlock: "NO_RECORD" });
    const strict = adsGatePolicy(policy);
    expect(strict.ADS_MEASUREMENT.mode).toBe("required");
    expect(consentDecision([], "ADS_MEASUREMENT", null, NOW, { policy: strict }).allowed).toBe(false);
    expect(policy.ADS_MEASUREMENT.mode).toBe("record_only"); // not mutated
  });
});

describe("adsMeasurementNotice (configurable policy text)", () => {
  it("has a neutral default that names no recipient other than platforms and says withdrawal is possible", () => {
    const t = adsMeasurementNotice({});
    expect(t.text).toBe(ADS_MEASUREMENT_NOTICE_DEFAULT);
    expect(t.text).toMatch(/withdraw/i);
    expect(t.text).toMatch(/never share your name/i);
    expect(t.source).toBe("default");
  });
  it("takes wording and version from the environment, trimmed and capped", () => {
    const t = adsMeasurementNotice({ CONSENT_ADS_MEASUREMENT_NOTICE: "  Custom wording.  ", CONSENT_ADS_MEASUREMENT_NOTICE_VERSION: "2027-03" });
    expect(t).toMatchObject({ text: "Custom wording.", version: "2027-03", source: "custom" });
    expect(adsMeasurementNotice({ CONSENT_ADS_MEASUREMENT_NOTICE: "x".repeat(5000) }).text).toHaveLength(1000);
    expect(adsMeasurementNotice({ CONSENT_ADS_MEASUREMENT_NOTICE: "   " }).source).toBe("default");
  });
});

describe("ad measurement notice: approved wording", () => {
  const approved = { text: "Approved wording that compliance signed off and a second admin approved.", version: "2027-04" };
  it("the approved wording (and its version) beats the environment override and the default", () => {
    expect(adsMeasurementNotice({ CONSENT_ADS_MEASUREMENT_NOTICE: "From env", CONSENT_ADS_MEASUREMENT_NOTICE_VERSION: "env-1" }, approved)).toEqual({ text: approved.text, version: "2027-04", source: "approved" });
  });
  it("without one, the environment override and then the default apply, as before", () => {
    expect(adsMeasurementNotice({ CONSENT_ADS_MEASUREMENT_NOTICE: "From env", CONSENT_ADS_MEASUREMENT_NOTICE_VERSION: "env-1" }, null)).toMatchObject({ text: "From env", version: "env-1", source: "custom" });
    expect(adsMeasurementNotice({}, undefined)).toMatchObject({ source: "default" });
  });
  it("an empty approved record is ignored rather than shown as a blank notice", () => {
    expect(adsMeasurementNotice({}, { text: " ", version: "x" }).source).toBe("default");
  });
});

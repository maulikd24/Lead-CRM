import { describe, expect, it } from "vitest";

import { FakeDestination } from "./fake-destination";
import { buildDestination, closedLoopEnabled, killSwitchOn, parseDestinationSettings, parseGlobalSettings, REAL_FIELDS } from "./config";

describe("flags", () => {
  it("is on only for the exact value 1", () => {
    expect(closedLoopEnabled({})).toBe(false);
    expect(closedLoopEnabled({ CLOSED_LOOP_CONVERSIONS_ENABLED: "true" })).toBe(false);
    expect(closedLoopEnabled({ CLOSED_LOOP_CONVERSIONS_ENABLED: "1" })).toBe(true);
  });
  it("the kill switch is on from the environment or from the stored setting", () => {
    expect(killSwitchOn({}, { killSwitch: false, aumBands: null })).toBe(false);
    expect(killSwitchOn({ CLOSED_LOOP_KILL_SWITCH: "1" }, { killSwitch: false, aumBands: null })).toBe(true);
    expect(killSwitchOn({}, { killSwitch: true, aumBands: null })).toBe(true);
  });
});

describe("parseDestinationSettings", () => {
  it("defaults to off, no region approved, no values", () => {
    expect(parseDestinationSettings(null)).toEqual({ enabled: false, region: null, allowedRegions: [], sendValue: false });
    expect(parseDestinationSettings("junk")).toEqual({ enabled: false, region: null, allowedRegions: [], sendValue: false });
  });
  it("reads only well-formed values", () => {
    expect(parseDestinationSettings({ enabled: true, region: " Global ", allowedRegions: ["global", 5, " in "], sendValue: true })).toEqual({ enabled: true, region: "global", allowedRegions: ["global", "in"], sendValue: true });
    expect(parseDestinationSettings({ enabled: "yes" }).enabled).toBe(false);
  });
});

describe("parseGlobalSettings", () => {
  it("kill switch false and AUM bands off by default; accepts a valid band list", () => {
    expect(parseGlobalSettings(null)).toEqual({ killSwitch: false, aumBands: null });
    expect(parseGlobalSettings({ killSwitch: true, aumBands: [{ label: "5L", min: 500000 }, { label: "bad" }, { label: "1Cr", min: 10000000 }] })).toEqual({ killSwitch: true, aumBands: [{ label: "5L", min: 500000 }, { label: "1Cr", min: 10000000 }] });
    expect(parseGlobalSettings({ aumBands: [] }).aumBands).toBeNull();
  });
});

describe("buildDestination", () => {
  const fetchStub = async () => ({ status: 200, ok: true, json: async () => ({}) });
  it("meta: needs pixel id and access token; trims; leaves the secret out of the object's visible fields", () => {
    expect(buildDestination("meta_capi", { pixelId: "1" }, fetchStub)).toBeNull();
    const d = buildDestination("meta_capi", { pixelId: " 123 ", accessToken: " tok ", testEventCode: "" }, fetchStub);
    expect(d).toMatchObject({ key: "meta_capi", platform: "meta" });
    expect(JSON.stringify(d)).not.toContain("tok");
  });
  it("google: needs every credential and at least one conversion action", () => {
    const full = { customerId: "123", developerToken: "d", clientId: "c", clientSecret: "s", refreshToken: "r", conversionActionKyc: "1" };
    expect(buildDestination("google_ads", { ...full, refreshToken: "" }, fetchStub)).toBeNull();
    expect(buildDestination("google_ads", { ...full, conversionActionKyc: "" }, fetchStub)).toBeNull();
    expect(buildDestination("google_ads", full, fetchStub)).toMatchObject({ key: "google_ads", platform: "google" });
  });
  it("fake: only when demo mode is on, never needs credentials", () => {
    expect(buildDestination("fake", {}, fetchStub, { demo: false })).toBeNull();
    expect(buildDestination("fake", {}, fetchStub, { demo: true })).toBeInstanceOf(FakeDestination);
  });
  it("lists the credential fields the Destinations form asks an Admin for", () => {
    expect(REAL_FIELDS.meta_capi.map((f) => f.key)).toEqual(["pixelId", "accessToken", "testEventCode"]);
    expect(REAL_FIELDS.google_ads.map((f) => f.key)).toContain("developerToken");
  });
});

import { bandsToText, parseBandsText } from "./config";

describe("parseBandsText", () => {
  it("reads label=rupees lines or comma lists, with lakh/crore shorthand, sorted by size", () => {
    expect(parseBandsText("50L=5000000, 10L=1000000\n1Cr=10000000")).toEqual({ ok: true, bands: [{ label: "10L", min: 1000000 }, { label: "50L", min: 5000000 }, { label: "1Cr", min: 10000000 }] });
    expect(parseBandsText("10L=10 lakh, 1Cr=1 crore")).toEqual({ ok: true, bands: [{ label: "10L", min: 1000000 }, { label: "1Cr", min: 10000000 }] });
  });
  it("blank means off; bad lines are reported, not guessed", () => {
    expect(parseBandsText("  ")).toEqual({ ok: true, bands: null });
    expect(parseBandsText("10L=abc")).toEqual({ ok: false, error: "Could not read “10L=abc”. Use label=rupees, for example 10L=1000000." });
    expect(parseBandsText("a=1,b=1")).toMatchObject({ ok: false });
    expect(parseBandsText(Array.from({ length: 11 }, (_, i) => `b${i}=${(i + 1) * 100}`).join(","))).toMatchObject({ ok: false });
  });
  it("round-trips for the edit box", () => {
    expect(bandsToText([{ label: "10L", min: 1000000 }])).toBe("10L=1000000");
    expect(bandsToText(null)).toBe("");
  });
});

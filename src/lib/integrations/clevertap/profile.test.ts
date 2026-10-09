import { describe, expect, it } from "vitest";
import sample from "./__fixtures__/profile.sample.json";
import { parseProfile } from "./profile";

describe("parseProfile", () => {
  it("returns null for errors and empty records", () => {
    for (const bad of [null, "x", {}, { status: "fail" }, { status: "success" }, { status: "success", record: null }]) expect(parseProfile(bad)).toBeNull();
  });
  it("extracts platforms, last seen and push flag defensively", () => {
    const p = parseProfile({
      status: "success",
      record: {
        platformInfo: [{ platform: "Android", push_token: "tok" }, { platform: "iOS" }],
        profileData: { av_lifecycle_stage: "KYC", Name: "Riya", nested: { a: 1 } },
        events: { "App Launched": { last_seen: 1760000000 } },
      },
    });
    expect(p).toMatchObject({ found: true, platforms: ["Android", "iOS"], pushEnabled: true });
    expect(p?.properties).toMatchObject({ av_lifecycle_stage: "KYC" });
    expect(p?.properties).not.toHaveProperty("nested");
  });
  it("copes with missing optional parts", () => {
    expect(parseProfile({ status: "success", record: { profileData: {} } })).toMatchObject({ found: true, platforms: [], pushEnabled: null, lastSeen: null });
  });
  it("parses the documentation-derived fixture", () => {
    const p = parseProfile(sample);
    expect(p).toEqual({
      found: true,
      platforms: ["iOS", "Web"],
      lastSeen: "2024-01-01T00:00:00.000Z",
      pushEnabled: true,
      properties: expect.objectContaining({ av_lifecycle_stage: "KYC", av_accepts_pms: false, Name: "Riya Synthetic" }),
    });
    expect(p?.properties).not.toHaveProperty("subscription-groups");
  });
  it("reports push off when platforms exist but none has a token", () => {
    expect(parseProfile({ status: "success", record: { platformInfo: [{ platform: "Web" }] } })).toMatchObject({ pushEnabled: false });
  });
  it("survives hostile shapes without throwing", () => {
    const hostile: unknown[] = [
      { status: "success", record: [] },
      { status: "success", record: { platformInfo: {}, profileData: [], events: [] } },
      { status: "success", record: { platformInfo: "x", profileData: "y", events: 5 } },
      { status: "success", record: { platformInfo: [null, 1, "a", { platform: 5 }], profileData: null, events: { "App Launched": null } } },
      { status: "success", record: { events: { "App Launched": { last_seen: "1704067200" } } } },
      { status: "success", record: { events: { "App Launched": { last_seen: 1e20 } } } },
      { status: "success", record: { events: { "App Launched": { last_seen: Number.NaN } } } },
    ];
    for (const h of hostile) {
      expect(() => parseProfile(h)).not.toThrow();
      const p = parseProfile(h);
      expect(p?.lastSeen ?? null).toBeNull();
    }
  });
  it("bounds huge inputs", () => {
    const platformInfo = Array.from({ length: 100_000 }, () => ({ platform: "Android", push_token: "t" }));
    const profileData = Object.fromEntries(Array.from({ length: 100_000 }, (_, i) => [`k${i}`, i]));
    const p = parseProfile({ status: "success", record: { platformInfo, profileData } });
    expect(p!.platforms.length).toBeLessThanOrEqual(10);
    expect(Object.keys(p!.properties).length).toBeLessThanOrEqual(200);
  });
  it("dedupes platforms and truncates long strings", () => {
    const p = parseProfile({ status: "success", record: { platformInfo: [{ platform: "iOS" }, { platform: "iOS" }], profileData: { a: "x".repeat(5000) } } });
    expect(p!.platforms).toEqual(["iOS"]);
    expect((p!.properties.a as string).length).toBeLessThanOrEqual(200);
  });
});

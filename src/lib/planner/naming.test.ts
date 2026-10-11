import { describe, expect, it } from "vitest";

import { buildUtm, campaignSlug, isValidUtmValue, newCampaignCode, isCampaignCode, containsPii } from "./naming";

describe("campaign code", () => {
  it("has a fixed shape without look-alike characters", () => {
    const code = newCampaignCode(() => 0.5);
    expect(code).toMatch(/^CP-[A-HJ-NP-Z2-9]{6}$/);
    expect(isCampaignCode(code)).toBe(true);
    expect(isCampaignCode("cp-abc")).toBe(false);
    expect(isCampaignCode("CP-0O1IL2")).toBe(false);
  });
  it("varies with the random source", () => {
    let n = 0;
    const seq = () => ((n += 0.137) % 1);
    expect(newCampaignCode(seq)).not.toBe(newCampaignCode(seq));
  });
});

describe("UTM naming convention", () => {
  it("accepts lowercase letters, digits, underscore and hyphen up to 40 characters", () => {
    for (const v of ["google", "click_to_whatsapp", "salaried-q4", "a1"]) expect(isValidUtmValue(v), v).toBe(true);
    for (const v of ["", "Google", "two words", "a".repeat(41), "x/y", "naïve", "a&b"]) expect(isValidUtmValue(v), v).toBe(false);
  });
  it("builds the five parameters from validated parts", () => {
    const r = buildUtm({ source: "google", medium: "cpc", campaign: "salaried_retirement_check_2026q4", content: "v1", term: "retirement_calculator" });
    expect(r).toEqual({ ok: true, params: { utm_source: "google", utm_medium: "cpc", utm_campaign: "salaried_retirement_check_2026q4", utm_content: "v1", utm_term: "retirement_calculator" } });
  });
  it("leaves out empty optional parts", () => {
    const r = buildUtm({ source: "meta", medium: "paid_social", campaign: "x_y" });
    expect(r.ok && Object.keys(r.params)).toEqual(["utm_source", "utm_medium", "utm_campaign"]);
  });
  it("rejects an invalid part and names it", () => {
    const r = buildUtm({ source: "Google Ads", medium: "cpc", campaign: "ok" });
    expect(r).toEqual({ ok: false, errors: [{ field: "source", message: expect.stringMatching(/lowercase/i) }] });
  });
  it("requires source, medium and campaign", () => {
    const r = buildUtm({ source: "", medium: "", campaign: "" });
    expect(!r.ok && r.errors.map((e) => e.field)).toEqual(["source", "medium", "campaign"]);
  });
  it("never lets a person's details into a parameter", () => {
    for (const v of ["asha@example.com", "9876543210", "919876543210", "ABCDE1234F"]) {
      expect(containsPii(v), v).toBe(true);
    }
    expect(containsPii("salaried_2026q4")).toBe(false);
    expect(containsPii("CP-7K3Q9X")).toBe(false);
    const r = buildUtm({ source: "email", medium: "email", campaign: "ok", content: "9876543210" });
    expect(r.ok).toBe(false);
  });
});

describe("campaign slug", () => {
  it("turns a name into a convention-safe slug", () => {
    expect(campaignSlug("Salaried professionals", "See if you are on track for retirement", "2026-10-01")).toBe("salaried_see_if_you_are_on_track_2026q4");
  });
  it("is always valid and at most 40 characters", () => {
    const s = campaignSlug("NRIs & Co.", "Invest from India as an NRI: what to know before you begin", "2027-01-15");
    expect(isValidUtmValue(s)).toBe(true);
    expect(s.length).toBeLessThanOrEqual(40);
  });
});

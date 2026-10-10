import { describe, expect, it } from "vitest";

import { createCampaignResolver } from "@/lib/marketing/attribution";

import { attribute, groupOf, type AttributionContext, type AttributionInput } from "./model";

const META = [
  { campaignId: "111", campaignName: "Retirement Planning - Lead Form" },
  { campaignId: "222", campaignName: "ELSS Tax Saving" },
  { campaignId: "333", campaignName: "Twin" },
  { campaignId: "334", campaignName: "Twin" },
];
const GOOGLE = [{ campaignId: "g9", campaignName: "NRI Investing - Search" }];

const ctx: AttributionContext = {
  timezone: "Asia/Kolkata",
  meta: createCampaignResolver(META, []),
  google: createCampaignResolver(GOOGLE, []),
  names: { meta: new Map(META.map((c) => [c.campaignId, c.campaignName])), google: new Map(GOOGLE.map((c) => [c.campaignId, c.campaignName])) },
};

const at = (iso: string) => new Date(iso);
const base = (over: Partial<AttributionInput> = {}): AttributionInput => ({
  clientId: "c1",
  createdAt: at("2027-03-02T05:00:00Z"),
  leadSource: "Meta Ads",
  leadAttribution: { source: "meta_leads", externalId: "L1", platform: "fb", campaign: "Retirement Planning - Lead Form", campaign_id: "111", ad: "Retire at 55 carousel", form: "F9" },
  intakes: [],
  partner: null,
  referral: null,
  fundedAt: null,
  ...over,
});

describe("first touch from the lead's own markers", () => {
  it("a Meta lead whose campaign id is a synced campaign is a high-confidence campaign touch, with creative and form", () => {
    const r = attribute(base(), ctx);
    expect(r.status).toBe("attributed");
    expect(r.first).toMatchObject({ kind: "meta_ad", confidence: "high", rule: "campaign_id", creative: "Retire at 55 carousel", form: "F9", campaign: { key: "meta:111", id: "111", name: "Retirement Planning - Lead Form", inSpendData: true } });
    expect(r.first?.why).toMatch(/campaign id 111/i);
    expect(r.confidence).toBe("high");
  });

  it("a campaign matched by name only is medium", () => {
    const r = attribute(base({ leadAttribution: { source: "meta_leads", externalId: "L1", platform: "ig", campaign: "elss tax saving" } }), ctx);
    expect(r.first).toMatchObject({ confidence: "medium", rule: "campaign_name", campaign: { key: "meta:222" } });
  });

  it("a campaign id the spend data does not know keeps the id the platform sent, flagged as having no spend data", () => {
    const r = attribute(base({ leadAttribution: { source: "meta_leads", externalId: "L1", platform: "fb", campaign: "Diwali PMS", campaign_id: "999" } }), ctx);
    expect(r.first).toMatchObject({ confidence: "medium", campaign: { key: "meta:999", id: "999", name: "Diwali PMS", inSpendData: false } });
    expect(r.first?.why).toMatch(/no spend/i);
  });

  it("an ambiguous campaign name is never guessed: channel known, campaign not", () => {
    const r = attribute(base({ leadAttribution: { source: "meta_leads", externalId: "L1", platform: "fb", campaign: "Twin" } }), ctx);
    expect(r.first).toMatchObject({ kind: "meta_ad", confidence: "low", campaign: null });
    expect(r.first?.why).toMatch(/more than one/i);
    expect(groupOf(r.first)).toMatchObject({ key: "meta:unknown" });
  });

  it("Meta markers without any campaign information are channel-only and low", () => {
    const r = attribute(base({ leadAttribution: { source: "web", externalId: "W1", fbclid: "abc" } }), ctx);
    expect(r.first).toMatchObject({ kind: "meta_ad", confidence: "low", campaign: null });
  });

  it("the creative is the ad name, or the creative id the platform sent, or utm_content from a landing page", () => {
    const c = (a: Record<string, unknown>) => attribute(base({ leadAttribution: { source: "meta_leads", externalId: "L1", platform: "fb", campaign_id: "111", ...a } }), ctx).first?.creative;
    expect(c({ ad: "Retire at 55 carousel" })).toBe("Retire at 55 carousel");
    expect(c({ creative: "cr-778" })).toBe("cr-778");
    expect(c({ utm_content: "retirement-reel-b" })).toBe("retirement-reel-b");
    expect(c({ ad: "A", utm_content: "B" })).toBe("A");
    expect(c({})).toBeNull();
  });

  it("a Google lead resolves against Google campaigns", () => {
    const r = attribute(base({ leadSource: "Google Ads", leadAttribution: { source: "google_ads", externalId: "G1", gclid: "x", campaign_id: "g9" } }), ctx);
    expect(r.first).toMatchObject({ kind: "google_ad", confidence: "high", campaign: { key: "google:g9", name: "NRI Investing - Search" } });
  });

  it("a lead carrying both click ids is not guessed at: it is not placed in a channel", () => {
    const r = attribute(base({ leadSource: null, leadAttribution: { source: "web", externalId: "W2", fbclid: "a", gclid: "b" } }), ctx);
    expect(r.status).toBe("unattributed");
  });

  it("the lead source label alone (no details) is channel-only and low, never a campaign", () => {
    const r = attribute(base({ leadAttribution: null, leadSource: "Instagram Ads" }), ctx);
    expect(r.first).toMatchObject({ kind: "meta_ad", confidence: "low", campaign: null });
  });

  it("a website form is a form touch; a sign-up on their own is organic", () => {
    expect(attribute(base({ leadSource: "Contact Form", leadAttribution: { source: "web", externalId: "W3", form: "contact-us" } }), ctx).first).toMatchObject({ kind: "form", form: "contact-us", confidence: "medium" });
    expect(attribute(base({ leadSource: "Organic Signup", leadAttribution: { source: "allvest_app", externalId: "A1" } }), ctx).first).toMatchObject({ kind: "organic", confidence: "medium" });
  });

  it("hand-entered or label-only sources are unattributed with a reason, never guessed", () => {
    const manual = attribute(base({ leadSource: "WhatsApp", leadAttribution: null }), ctx);
    expect(manual).toMatchObject({ status: "unattributed", first: null, last: null, confidence: null, reason: "manual_source" });
    expect(manual.reasonText).toMatch(/WhatsApp/);
    expect(attribute(base({ leadSource: null, leadAttribution: null }), ctx)).toMatchObject({ status: "unattributed", reason: "no_markers" });
  });
});

describe("codes", () => {
  it("a verified partner code is a high-confidence touch, and wins when it arrives with the ad markers at the same signup", () => {
    const r = attribute(base({ partner: { code: "PTR-7K2", at: at("2027-03-02T05:00:10Z"), source: "web" } }), ctx);
    expect(r.first).toMatchObject({ kind: "partner_code", code: "PTR-7K2", confidence: "high" });
    expect(r.touches.map((t) => t.kind)).toEqual(["partner_code", "meta_ad"]);
  });

  it("a referral code is a touch; partner code outranks referral code at the same moment", () => {
    const r = attribute(base({ leadSource: "App Signup", leadAttribution: { source: "allvest_app", externalId: "A2" }, referral: { code: "AB12CD34", at: at("2027-03-02T05:00:00Z") }, partner: { code: "PTR-1", at: at("2027-03-02T05:00:00Z"), source: "app" } }), ctx);
    expect(r.first?.kind).toBe("partner_code");
    expect(r.touches.map((t) => t.kind)).toEqual(["partner_code", "referral_code", "organic"]);
  });

  it("an earlier ad touch is the first touch; a later partner code is not", () => {
    const r = attribute(base({ partner: { code: "PTR-7K2", at: at("2027-03-09T05:00:00Z"), source: "web" } }), ctx);
    expect(r.first?.kind).toBe("meta_ad");
    expect(r.last?.kind).toBe("partner_code");
  });
});

describe("re-enquiries and the last touch", () => {
  const reenquiry = { source: "google_ads", externalId: "G2", at: at("2027-03-10T05:00:00Z"), leadSource: "Google Ads", attribution: { source: "google_ads", externalId: "G2", gclid: "z", campaign_id: "g9" } };

  it("the ledger row that created the lead is the first touch itself and is not counted twice", () => {
    const r = attribute(base({ intakes: [{ source: "meta_leads", externalId: "L1", at: at("2027-03-02T05:00:00Z"), leadSource: "Meta Ads", attribution: { source: "meta_leads", externalId: "L1", campaign_id: "111" } }] }), ctx);
    expect(r.touches).toHaveLength(1);
  });

  it("a later enquiry through another campaign is the last touch; the first stays", () => {
    const r = attribute(base({ intakes: [reenquiry] }), ctx);
    expect(r.first?.campaign?.key).toBe("meta:111");
    expect(r.last?.campaign?.key).toBe("google:g9");
    expect(r.touches).toHaveLength(2);
  });

  it("with a funding date, the last touch is the last one at or before it", () => {
    const r = attribute(base({ intakes: [reenquiry], fundedAt: at("2027-03-05T00:00:00Z") }), ctx);
    expect(r.last?.campaign?.key).toBe("meta:111");
  });

  it("an unknown-quality re-enquiry with no markers adds no touch", () => {
    const r = attribute(base({ intakes: [{ source: "web", externalId: "W9", at: at("2027-03-10T05:00:00Z"), leadSource: "WhatsApp", attribution: null }] }), ctx);
    expect(r.touches).toHaveLength(1);
  });
});

describe("groupOf (what a touch is counted under)", () => {
  it("campaigns by key; everything else by its kind", () => {
    expect(groupOf(attribute(base(), ctx).first)).toEqual({ key: "meta:111", label: "Retirement Planning - Lead Form", kind: "campaign" });
    expect(groupOf(attribute(base({ partner: { code: "P", at: at("2027-03-02T05:00:00Z"), source: "web" } }), ctx).first)).toMatchObject({ key: "partner_code", kind: "source" });
    expect(groupOf(null)).toEqual({ key: "unattributed", label: "Unattributed", kind: "unattributed" });
  });
});

import { describe, expect, it } from "vitest";
import { attributeLeads, isGoogleLead, isLeadOfChannel, isMetaLead, type AdActivity, type AdIdentity, type LeadRecord } from "./attribution";

const campaigns: AdIdentity[] = [
  { campaignId: "9001", campaignName: "Search - Demat Account" },
  { campaignId: "9002", campaignName: "PMax: Wealth Leads" },
];
const activity: AdActivity[] = [];

let n = 0;
function lead(attribution: Record<string, unknown> | null, over: Partial<LeadRecord> = {}): LeadRecord {
  n++;
  return { clientId: `g${n}`, day: "2026-10-05", leadSource: "Google Ads", attribution, ...over };
}

describe("isGoogleLead", () => {
  it("recognises the Google lead-form intake, a gclid, a Google lead source and Google utm_source values", () => {
    expect(isGoogleLead(lead({ source: "google_ads", platform: "google" }))).toBe(true);
    expect(isGoogleLead(lead({ gclid: "abc" }, { leadSource: "Contact Form" }))).toBe(true);
    expect(isGoogleLead(lead({}, { leadSource: "Google Ads" }))).toBe(true);
    expect(isGoogleLead(lead({ utm_source: "Google" }, { leadSource: null }))).toBe(true);
    expect(isGoogleLead(lead({ utm_source: "adwords" }, { leadSource: null }))).toBe(true);
    expect(isGoogleLead(lead({ platform: "google" }, { leadSource: null }))).toBe(true);
  });

  it("rejects Meta, web and manual leads, and a lead carrying both click ids is not guessed at", () => {
    expect(isGoogleLead(lead({ source: "meta_leads" }, { leadSource: "Meta Ads" }))).toBe(false);
    expect(isGoogleLead(lead({ fbclid: "f" }, { leadSource: "Instagram Ads" }))).toBe(false);
    expect(isGoogleLead(lead({ gclid: "g", fbclid: "f" }, { leadSource: null }))).toBe(false);
    expect(isGoogleLead(lead({ utm_source: "newsletter" }, { leadSource: "Contact Form" }))).toBe(false);
    expect(isGoogleLead(lead(null))).toBe(false);
  });

  it("a lead is never both Meta and Google", () => {
    const samples = [
      lead({ source: "google_ads", gclid: "x" }),
      lead({ source: "meta_leads" }, { leadSource: "Meta Ads" }),
      lead({ gclid: "g", fbclid: "f" }, { leadSource: null }),
      lead({ utm_source: "facebook", gclid: "g" }, { leadSource: null }),
    ];
    for (const s of samples) expect(isGoogleLead(s) && isMetaLead(s)).toBe(false);
  });
});

describe("isLeadOfChannel", () => {
  it("dispatches by channel", () => {
    const g = lead({ source: "google_ads" });
    expect(isLeadOfChannel("google", g)).toBe(true);
    expect(isLeadOfChannel("meta", g)).toBe(false);
  });
});

describe("attributeLeads for the google channel", () => {
  it("matches by the campaign id (the lead form stores it in `campaign`), then by name, then by utm_campaign", () => {
    const { assignments, excluded } = attributeLeads(
      [lead({ source: "google_ads", campaign: "9001" }), lead({ gclid: "x", campaign: "pmax wealth leads" }), lead({ gclid: "y", utm_campaign: "9002" }), lead({ source: "meta_leads" }, { leadSource: "Meta Ads" })],
      campaigns,
      activity,
      "google",
    );
    expect(assignments.map((a) => [a.campaignId, a.rule])).toEqual([
      ["9001", "campaign_id"],
      ["9002", "campaign_name"],
      ["9002", "utm_campaign"],
    ]);
    expect(excluded.nonMeta).toBe(1); // "other channel" count keeps its original key
  });

  it("defaults to the meta channel so existing callers are unchanged", () => {
    const { assignments } = attributeLeads([lead({ source: "google_ads", campaign: "9001" })], campaigns, activity);
    expect(assignments).toHaveLength(0);
  });
});

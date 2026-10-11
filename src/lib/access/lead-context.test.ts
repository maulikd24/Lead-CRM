import { describe, expect, it } from "vitest";

import { LEAD_LABEL_KEYS, leadCampaignRows } from "./lead-context";

const attribution = {
  source: "meta_leads",
  externalId: "abc123",
  campaign: "Festive SIP push",
  campaign_name: "Festive SIP push",
  utm_source: "facebook",
  utm_medium: "paid_social",
  platform: "instagram",
  adset_name: "Metro 25-40",
  // Everything below is marketing's business. An RM must never see any of it.
  spend: "12000",
  daily_budget: "500",
  budget: "9000",
  cpl: "310",
  roas: "2.4",
  ad_account_id: "act_555",
  adAccount: "act_555",
  cost_per_lead: "310",
  campaign_id: "120001",
  form_id: "f1",
};

describe("the campaign label an RM may see on their own lead", () => {
  it.each(["RM", "MANAGER", "TEAM_MANAGER", "ADMIN"] as const)("gives %s the campaign name and source label", (role) => {
    const rows = Object.fromEntries(leadCampaignRows(role, attribution));
    expect(rows.campaign).toBe("Festive SIP push");
    expect(rows.utm_source).toBe("facebook");
    expect(rows.platform).toBe("instagram");
  });

  it.each(["RM", "MANAGER", "TEAM_MANAGER", "ADMIN"] as const)("never gives %s spend, cost per lead, return on spend, budgets, ad accounts or platform ids", (role) => {
    const keys = leadCampaignRows(role, attribution).map(([k]) => k);
    for (const forbidden of ["spend", "daily_budget", "budget", "cpl", "roas", "ad_account_id", "adAccount", "cost_per_lead", "campaign_id", "form_id", "externalId", "source"]) expect(keys, forbidden).not.toContain(forbidden);
    expect(JSON.stringify(leadCampaignRows(role, attribution))).not.toMatch(/12000|9000|act_555|310|2\.4/);
  });

  it.each(["MARKETING", "FINANCE", "DEALER", "PARTNER", "AFFILIATE", "DISTRIBUTOR"] as const)("gives %s nothing: a lead is not theirs to open", (role) => {
    expect(leadCampaignRows(role, attribution)).toEqual([]);
  });

  it("copes with a missing, empty or malformed attribution", () => {
    for (const bad of [null, undefined, "x", 5, [], [["campaign", "a"]]]) expect(leadCampaignRows("RM", bad)).toEqual([]);
  });

  it("drops non-text values and empty text", () => {
    expect(leadCampaignRows("RM", { campaign: "", platform: 5, utm_source: "google" })).toEqual([["utm_source", "google"]]);
  });

  it("allows only labels: a new key must be added to the list on purpose", () => {
    expect([...LEAD_LABEL_KEYS].sort()).toEqual(["adset_name", "campaign", "campaign_name", "platform", "utm_campaign", "utm_medium", "utm_source"].sort());
  });
});

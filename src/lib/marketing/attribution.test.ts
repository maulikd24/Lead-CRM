import { describe, expect, it } from "vitest";
import { attributeLeads, isMetaLead, normalizeCampaignName, type AdActivity, type AdIdentity, type LeadRecord } from "./attribution";

const campaigns: AdIdentity[] = [
  { campaignId: "111", campaignName: "Spring Brokerage 2026" },
  { campaignId: "222", campaignName: "HNI_Wealth - Lookalike" },
  { campaignId: "333", campaignName: "Dup Name" },
  { campaignId: "444", campaignName: "dup  name" },
];
const activity: AdActivity[] = [
  { campaignId: "333", date: "2026-10-05" },
  { campaignId: "444", date: "2026-09-01" },
];

let n = 0;
function lead(attribution: Record<string, unknown> | null, over: Partial<LeadRecord> = {}): LeadRecord {
  n++;
  return { clientId: `c${n}`, day: "2026-10-05", leadSource: "Meta Ads", attribution, ...over };
}
const run = (leads: LeadRecord[]) => attributeLeads(leads, campaigns, activity);

describe("normalizeCampaignName", () => {
  it("ignores case, punctuation, repeated spaces and accents", () => {
    expect(normalizeCampaignName("  HNI_Wealth - Lookalike ")).toBe("hni wealth lookalike");
    expect(normalizeCampaignName("Spring-Brokerage  2026")).toBe("spring brokerage 2026");
    expect(normalizeCampaignName("Café")).toBe("cafe");
    expect(normalizeCampaignName("")).toBe("");
  });
});

describe("isMetaLead", () => {
  it("recognises Meta by intake source, lead source, platform, utm_source or fbclid", () => {
    expect(isMetaLead({ clientId: "x", day: "d", attribution: { source: "meta_leads" } })).toBe(true);
    expect(isMetaLead({ clientId: "x", day: "d", leadSource: "Instagram Ads", attribution: {} })).toBe(true);
    expect(isMetaLead({ clientId: "x", day: "d", attribution: { utm_source: "Facebook" } })).toBe(true);
    expect(isMetaLead({ clientId: "x", day: "d", attribution: { fbclid: "abc" } })).toBe(true);
    expect(isMetaLead({ clientId: "x", day: "d", attribution: { platform: "ig" } })).toBe(true);
  });
  it("does not treat Google, web or manual leads as Meta", () => {
    expect(isMetaLead({ clientId: "x", day: "d", leadSource: "Google Ads", attribution: { gclid: "g", source: "google_ads" } })).toBe(false);
    expect(isMetaLead({ clientId: "x", day: "d", leadSource: "Contact Form", attribution: { utm_source: "newsletter" } })).toBe(false);
    expect(isMetaLead({ clientId: "x", day: "d", attribution: null })).toBe(false);
  });
});

describe("attributeLeads matching rules", () => {
  it("rule 1: campaign_id matches exactly", () => {
    const { assignments } = run([lead({ campaign_id: "111", campaign: "something else entirely" })]);
    expect(assignments[0]).toMatchObject({ campaignId: "111", rule: "campaign_id" });
  });

  it("rule 1b: the campaign field holding an id (the lead form falls back to the id) counts as an id match", () => {
    expect(run([lead({ campaign: "222" })]).assignments[0]).toMatchObject({ campaignId: "222", rule: "campaign_id" });
  });

  it("rule 2: normalised campaign name, when no id matches", () => {
    const { assignments } = run([lead({ campaign: "spring brokerage 2026" }), lead({ campaign_id: "999", campaign: "HNI WEALTH Lookalike" })]);
    expect(assignments[0]).toMatchObject({ campaignId: "111", rule: "campaign_name" });
    expect(assignments[1]).toMatchObject({ campaignId: "222", rule: "campaign_name" });
  });

  it("rule 3: utm_campaign as an id, then as a normalised name", () => {
    const { assignments } = run([lead({ utm_source: "facebook", utm_campaign: "111" }), lead({ utm_source: "fb", utm_campaign: "Spring_Brokerage_2026" })]);
    expect(assignments[0]).toMatchObject({ campaignId: "111", rule: "utm_campaign" });
    expect(assignments[1]).toMatchObject({ campaignId: "111", rule: "utm_campaign" });
  });

  it("applies rules in order: id beats name beats utm", () => {
    const a = run([lead({ campaign_id: "222", campaign: "Spring Brokerage 2026", utm_campaign: "333" })]).assignments[0];
    expect(a).toMatchObject({ campaignId: "222", rule: "campaign_id" });
    const b = run([lead({ campaign: "Spring Brokerage 2026", utm_campaign: "222" })]).assignments[0];
    expect(b).toMatchObject({ campaignId: "111", rule: "campaign_name" });
  });

  it("falls through to the next rule when an earlier value matches nothing", () => {
    expect(run([lead({ campaign_id: "000", campaign: "Unknown", utm_campaign: "Spring Brokerage 2026" })]).assignments[0]).toMatchObject({ campaignId: "111", rule: "utm_campaign" });
  });
});

describe("attributeLeads ties and the unattributed bucket", () => {
  it("breaks a name tie by which campaign was active around the lead date", () => {
    const a = run([lead({ campaign: "Dup Name" }, { day: "2026-10-06" })]).assignments[0];
    expect(a).toMatchObject({ campaignId: "333", rule: "campaign_name" });
    const b = run([lead({ campaign: "Dup Name" }, { day: "2026-09-02" })]).assignments[0];
    expect(b).toMatchObject({ campaignId: "444" });
  });

  it("leaves an unbreakable tie unattributed, with the reason", () => {
    const a = run([lead({ campaign: "Dup Name" }, { day: "2026-01-01" })]).assignments[0];
    expect(a).toMatchObject({ campaignId: null, reason: "ambiguous_campaign_name" });
  });

  it("falls to a later rule instead of giving up when a name is ambiguous", () => {
    const a = run([lead({ campaign: "Dup Name", utm_campaign: "111" }, { day: "2026-01-01" })]).assignments[0];
    expect(a).toMatchObject({ campaignId: "111", rule: "utm_campaign" });
  });

  it("puts Meta leads that match nothing in the unattributed bucket, with a reason", () => {
    const { assignments } = run([lead({ campaign_id: "9999", campaign: "Not In Ads" }), lead({ source: "meta_leads" }), lead({ fbclid: "x" })]);
    expect(assignments.map((a) => [a.campaignId, a.reason])).toEqual([
      [null, "no_match"],
      [null, "no_campaign_info"],
      [null, "no_campaign_info"],
    ]);
  });

  it("excludes non-Meta leads from attribution and counts them", () => {
    const res = run([lead({ gclid: "g", campaign: "Spring Brokerage 2026" }, { leadSource: "Google Ads" }), lead(null, { leadSource: "Walk-in" })]);
    expect(res.assignments).toHaveLength(0);
    expect(res.excluded.nonMeta).toBe(2);
  });
});

describe("attributeLeads de-duplication", () => {
  it("counts a client once even if it appears twice", () => {
    const a = lead({ campaign_id: "111" });
    const res = run([a, { ...a }]);
    expect(res.assignments).toHaveLength(1);
    expect(res.excluded.duplicates).toBe(1);
  });

  it("counts one provider lead id once even when two client rows carry it", () => {
    const res = run([lead({ source: "meta_leads", externalId: "L1", campaign_id: "111" }), lead({ source: "meta_leads", externalId: "L1", campaign_id: "111" }), lead({ source: "meta_leads", externalId: "L2", campaign_id: "111" })]);
    expect(res.assignments).toHaveLength(2);
    expect(res.excluded.duplicates).toBe(1);
  });

  it("ignores inherited garbage: non-string and over-long attribution values never match or throw", () => {
    const res = run([lead({ campaign_id: 111, campaign: { x: 1 }, utm_campaign: "x".repeat(5000) } as unknown as Record<string, unknown>, { leadSource: "Meta Ads" })]);
    expect(res.assignments[0].campaignId).toBeNull();
  });
});

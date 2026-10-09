import { addDays } from "./dates";

/**
 * Joins CRM leads (Client.leadAttribution) to ad campaigns (AdCampaignDaily). Pure: no database, no clock.
 *
 * Matching rules, applied in this order; the first rule that resolves to ONE campaign wins:
 *   1. campaign_id exact   (attribution.campaign_id, then attribution.campaign when it is itself an id)
 *   2. campaign name       (attribution.campaign, normalised: case, accents, punctuation and spacing ignored)
 *   3. utm_campaign        (as an id first, then as a normalised name)
 * A name shared by several campaigns is broken by activity: the campaign that had spend on the lead's day or in the
 * 3 days before is chosen, but only if exactly one did. Otherwise the rule is treated as unresolved and the next rule
 * is tried; if none resolves, the lead goes to the "unattributed" bucket with a reason.
 */

export type AdIdentity = { campaignId: string; campaignName: string };
export type AdActivity = { campaignId: string; date: string };

export type LeadRecord = {
  clientId: string;
  /** The lead's creation day in the ad account's timezone, YYYY-MM-DD. */
  day: string;
  leadSource?: string | null;
  attribution: Record<string, unknown> | null;
};

export type MatchRule = "campaign_id" | "campaign_name" | "utm_campaign";
export type UnattributedReason = "no_campaign_info" | "no_match" | "ambiguous_campaign_name";

export type Assignment<L extends LeadRecord = LeadRecord> = {
  lead: L;
  campaignId: string | null;
  rule: MatchRule | null;
  reason: UnattributedReason | null;
};

export type AttributionResult<L extends LeadRecord = LeadRecord> = {
  assignments: Assignment<L>[];
  excluded: { nonMeta: number; duplicates: number };
};

const MAX_VALUE = 300;
const TIE_LOOKBACK_DAYS = 3;
const META_UTM_SOURCES = new Set(["facebook", "fb", "instagram", "ig", "meta", "facebook ads", "instagram ads", "meta ads"]);
const META_LEAD_SOURCES = new Set(["meta ads", "instagram ads"]);
const META_PLATFORMS = new Set(["fb", "ig", "facebook", "instagram", "messenger", "audience_network", "an"]);

export function normalizeCampaignName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function text(attribution: Record<string, unknown> | null, key: string): string | undefined {
  const value = attribution?.[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= MAX_VALUE ? trimmed : undefined;
}

const NON_META_UTM_SOURCES = new Set(["google", "google ads", "adwords", "youtube", "bing", "linkedin", "twitter", "x", "tiktok"]);

/**
 * Whether a lead came from Meta (Facebook or Instagram) ads; only those are matched against Meta campaigns.
 * A lead that arrived through the Meta lead-form intake is Meta. Any other marker is rejected if something contradicts
 * it (a gclid, a Google lead source, or a non-Meta utm_source), so a lead carrying both click ids is not guessed at.
 */
export function isMetaLead(lead: LeadRecord): boolean {
  const a = lead.attribution;
  if (!a) return false;
  if (text(a, "source") === "meta_leads") return true;
  const leadSource = (lead.leadSource ?? "").trim().toLowerCase();
  const utmSource = (text(a, "utm_source") ?? "").toLowerCase();
  const contradicted = Boolean(text(a, "gclid")) || leadSource === "google ads" || text(a, "source") === "google_ads" || NON_META_UTM_SOURCES.has(utmSource);
  if (contradicted) return false;
  if (META_LEAD_SOURCES.has(leadSource)) return true;
  if (META_PLATFORMS.has((text(a, "platform") ?? "").toLowerCase())) return true;
  if (META_UTM_SOURCES.has(utmSource)) return true;
  return Boolean(text(a, "fbclid"));
}

type Index = {
  ids: Set<string>;
  byName: Map<string, string[]>;
  activeDays: Map<string, Set<string>>;
};

function buildIndex(campaigns: AdIdentity[], activity: AdActivity[]): Index {
  const ids = new Set<string>();
  const byName = new Map<string, string[]>();
  // Every (id, name) pair is indexed, so a renamed campaign keeps matching leads that carry its old name.
  for (const c of campaigns) {
    ids.add(c.campaignId);
    const key = normalizeCampaignName(c.campaignName);
    const known = byName.get(key) ?? [];
    if (key && !known.includes(c.campaignId)) byName.set(key, [...known, c.campaignId]);
  }
  const activeDays = new Map<string, Set<string>>();
  for (const a of activity) {
    const set = activeDays.get(a.campaignId) ?? new Set<string>();
    set.add(a.date);
    activeDays.set(a.campaignId, set);
  }
  return { ids, byName, activeDays };
}

type Resolution = { campaignId: string } | { ambiguous: true } | null;

function resolveName(name: string, day: string, index: Index): Resolution {
  const candidates = index.byName.get(normalizeCampaignName(name));
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return { campaignId: candidates[0] };
  const recent = candidates.filter((id) => {
    const days = index.activeDays.get(id);
    if (!days) return false;
    for (let back = 0; back <= TIE_LOOKBACK_DAYS; back++) if (days.has(addDays(day, -back))) return true;
    return false;
  });
  return recent.length === 1 ? { campaignId: recent[0] } : { ambiguous: true };
}

function resolve(lead: LeadRecord, index: Index): Pick<Assignment, "campaignId" | "rule" | "reason"> {
  const a = lead.attribution;
  const campaignId = text(a, "campaign_id");
  const campaign = text(a, "campaign");
  const utm = text(a, "utm_campaign");
  let ambiguous = false;

  if (campaignId && index.ids.has(campaignId)) return { campaignId, rule: "campaign_id", reason: null };
  if (campaign && index.ids.has(campaign)) return { campaignId: campaign, rule: "campaign_id", reason: null };

  if (campaign) {
    const byName = resolveName(campaign, lead.day, index);
    if (byName && "campaignId" in byName) return { campaignId: byName.campaignId, rule: "campaign_name", reason: null };
    if (byName) ambiguous = true;
  }

  if (utm) {
    if (index.ids.has(utm)) return { campaignId: utm, rule: "utm_campaign", reason: null };
    const byName = resolveName(utm, lead.day, index);
    if (byName && "campaignId" in byName) return { campaignId: byName.campaignId, rule: "utm_campaign", reason: null };
    if (byName) ambiguous = true;
  }

  const hasInfo = Boolean(campaignId || campaign || utm);
  return { campaignId: null, rule: null, reason: ambiguous ? "ambiguous_campaign_name" : hasInfo ? "no_match" : "no_campaign_info" };
}

/**
 * De-duplicates by client id and by provider lead id (source + externalId), drops non-Meta leads (counted), and
 * assigns every remaining lead to a campaign or to the unattributed bucket.
 */
export function attributeLeads<L extends LeadRecord>(leads: L[], campaigns: AdIdentity[], activity: AdActivity[]): AttributionResult<L> {
  const index = buildIndex(campaigns, activity);
  const seenClients = new Set<string>();
  const seenProviderIds = new Set<string>();
  const assignments: Assignment<L>[] = [];
  const excluded = { nonMeta: 0, duplicates: 0 };

  for (const lead of leads) {
    if (seenClients.has(lead.clientId)) {
      excluded.duplicates++;
      continue;
    }
    seenClients.add(lead.clientId);

    if (!isMetaLead(lead)) {
      excluded.nonMeta++;
      continue;
    }

    const source = text(lead.attribution, "source");
    const externalId = text(lead.attribution, "externalId");
    if (source && externalId) {
      const key = `${source}:${externalId}`;
      if (seenProviderIds.has(key)) {
        excluded.duplicates++;
        continue;
      }
      seenProviderIds.add(key);
    }

    assignments.push({ lead, ...resolve(lead, index) });
  }
  return { assignments, excluded };
}

import { isGoogleLead, isMetaLead, type LeadRecord, type MatchRule, type UnattributedReason as CampaignReason } from "@/lib/marketing/attribution";
import { todayInTimeZone } from "@/lib/marketing/dates";

/**
 * Customer-level attribution. Pure: no database, no clock.
 *
 * Every touch a customer left is turned into one `Touch` (a Meta or Google ad, a website form, a partner code, a referral
 * code, or an organic sign-up). The FIRST touch is the earliest; the LAST touch is the latest one at or before the first
 * funding (or the latest of all while the customer has not funded). Ad campaigns are matched with the marketing module's
 * own rules (campaign id, then name, then utm_campaign; a name shared by several campaigns is not guessed), so the two
 * screens can never disagree. Every touch carries a confidence and a plain-English reason; anything that cannot be tied
 * to a touch is `unattributed`, with the reason, and is never assigned to a campaign.
 *
 * Confidence:
 *   high    the platform's campaign id matches a synced campaign, or a partner or referral code that exists in our own tables
 *   medium  the campaign matched by name or utm_campaign; a campaign id the spend data does not know; a website form; an organic sign-up
 *   low     the channel is known (Meta or Google) but the campaign is not
 */

export type TouchKind = "meta_ad" | "google_ad" | "partner_code" | "referral_code" | "form" | "organic";
export type Confidence = "high" | "medium" | "low";
export type AdChannelKey = "meta" | "google";

export type Touch = {
  kind: TouchKind;
  /** ISO timestamp. */
  at: string;
  campaign: { key: string; id: string | null; name: string | null; inSpendData: boolean } | null;
  creative: string | null;
  form: string | null;
  code: string | null;
  confidence: Confidence;
  rule: string;
  /** One sentence, written for the person reading the Journey: why this touch is credited this way. */
  why: string;
};

export type UnattributedReason = "no_markers" | "manual_source" | "conflicting_markers";

export type Attribution =
  | { status: "attributed"; first: Touch; last: Touch; touches: Touch[]; confidence: Confidence; reason: null; reasonText: null }
  | { status: "unattributed"; first: null; last: null; touches: []; confidence: null; reason: UnattributedReason; reasonText: string };

type Resolver = (lead: LeadRecord) => { campaignId: string | null; rule: MatchRule | null; reason: CampaignReason | null };

export type AttributionContext = {
  /** The ad account's timezone: day boundaries for the tie-break between campaigns that share a name. */
  timezone: string;
  meta: Resolver;
  google: Resolver;
  names: Record<AdChannelKey, Map<string, string>>;
};

export type IntakeTouch = { source: string; externalId: string; at: Date; leadSource: string | null; attribution: Record<string, unknown> | null };

export type AttributionInput = {
  clientId: string;
  createdAt: Date;
  leadSource: string | null;
  /** The snapshot written when the lead was created (the first touch's markers). */
  leadAttribution: Record<string, unknown> | null;
  /** Every ledger row linked to this client; the one that created the lead is recognised and not counted twice. */
  intakes: IntakeTouch[];
  /** A partner code that exists in our own tables (PartnerReferralTouch). */
  partner: { code: string; at: Date; source: string } | null;
  /** An attributed referral (Referral with outcome ATTRIBUTED) and the code it came through, when known. */
  referral: { code: string | null; at: Date } | null;
  /** First funding, when funded. */
  fundedAt: Date | null;
};

const SIMULTANEOUS_MS = 60_000;
const MAX_VALUE = 300;
/** At the same moment, the strongest evidence is first: a code we can verify, then an ad click, then a form, then nothing. */
const RANK: Record<TouchKind, number> = { partner_code: 0, referral_code: 1, meta_ad: 2, google_ad: 2, form: 3, organic: 4 };

function text(attribution: Record<string, unknown> | null, key: string): string | undefined {
  const value = attribution?.[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= MAX_VALUE ? trimmed : undefined;
}

const CHANNEL_NAME: Record<AdChannelKey, string> = { meta: "Meta", google: "Google" };
const LABEL_CHANNEL: Record<string, AdChannelKey> = { "meta ads": "meta", "instagram ads": "meta", "google ads": "google" };
const WEB_LABELS = new Set(["contact form", "website/blog post"]);
const ORGANIC_LABELS = new Set(["organic signup", "app signup"]);

type Raw = { at: Date; source: string | null; leadSource: string | null; attribution: Record<string, unknown> | null };

function adTouch(raw: Raw, channel: AdChannelKey, ctx: AttributionContext, clientId: string): Touch {
  const a = raw.attribution;
  const creative = text(a, "ad") ?? null;
  const form = text(a, "form") ?? null;
  const channelName = CHANNEL_NAME[channel];
  const kind: TouchKind = channel === "meta" ? "meta_ad" : "google_ad";
  const common = { kind, at: raw.at.toISOString(), creative, form, code: null as string | null };

  if (!a) {
    return { ...common, campaign: null, confidence: "low", rule: "source_label", why: `The lead source says ${channelName} ads, but no campaign details came with it, so no campaign is credited.` };
  }
  const lead: LeadRecord = { clientId, day: todayInTimeZone(raw.at, ctx.timezone), leadSource: raw.leadSource, attribution: a };
  const resolved = ctx[channel](lead);
  const sentId = text(a, "campaign_id");
  const sentName = text(a, "campaign") ?? text(a, "utm_campaign");

  if (resolved.campaignId) {
    const name = ctx.names[channel].get(resolved.campaignId) ?? sentName ?? resolved.campaignId;
    const byId = resolved.rule === "campaign_id";
    const how = byId ? `its campaign id ${resolved.campaignId} is a synced ${channelName} campaign` : resolved.rule === "campaign_name" ? `its campaign name "${sentName}" matches exactly one synced ${channelName} campaign` : `its utm_campaign "${sentName}" matches exactly one synced ${channelName} campaign`;
    return {
      ...common,
      campaign: { key: `${channel}:${resolved.campaignId}`, id: resolved.campaignId, name, inSpendData: true },
      confidence: byId ? "high" : "medium",
      rule: resolved.rule ?? "campaign_id",
      why: `Credited to "${name}": ${how}.`,
    };
  }
  if (sentId) {
    return {
      ...common,
      campaign: { key: `${channel}:${sentId}`, id: sentId, name: sentName ?? null, inSpendData: false },
      confidence: "medium",
      rule: "campaign_id_unsynced",
      why: `The ${channelName} lead carried campaign id ${sentId}${sentName ? ` ("${sentName}")` : ""}, which is not in the synced spend data yet, so there is no spend to compare it with.`,
    };
  }
  const detail =
    resolved.reason === "ambiguous_campaign_name"
      ? `its campaign name "${sentName}" belongs to more than one ${channelName} campaign and none was uniquely active, so it is not guessed`
      : resolved.reason === "no_match"
        ? `its campaign name "${sentName}" matches no synced ${channelName} campaign`
        : "it carried no campaign name or id";
  return { ...common, campaign: null, confidence: "low", rule: resolved.reason ?? "no_campaign_info", why: `The lead came from ${channelName} ads, but ${detail}, so only the channel is credited.` };
}

function touchFromRaw(raw: Raw, ctx: AttributionContext, clientId: string): Touch | null {
  const lead: LeadRecord = { clientId, day: "", leadSource: raw.leadSource, attribution: raw.attribution };
  const channel: AdChannelKey | null = isMetaLead(lead) ? "meta" : isGoogleLead(lead) ? "google" : null;
  if (channel) return adTouch(raw, channel, ctx, clientId);

  const label = (raw.leadSource ?? "").trim().toLowerCase();
  // Both click ids present: the two channels contradict each other, so neither is credited.
  if (raw.attribution && text(raw.attribution, "fbclid") && text(raw.attribution, "gclid")) return null;
  if (!raw.attribution && LABEL_CHANNEL[label]) return adTouch(raw, LABEL_CHANNEL[label], ctx, clientId);

  const at = raw.at.toISOString();
  if (raw.attribution && (WEB_LABELS.has(label) || raw.source === "web")) {
    const form = text(raw.attribution, "form") ?? raw.leadSource ?? null;
    return { kind: "form", at, campaign: null, creative: null, form, code: null, confidence: "medium", rule: "web_form", why: `Came in through a website form${form ? ` ("${form}")` : ""} with no ad or partner marker.` };
  }
  if (ORGANIC_LABELS.has(label)) {
    return { kind: "organic", at, campaign: null, creative: null, form: null, code: null, confidence: "medium", rule: "organic_signup", why: `Signed up on their own (${raw.leadSource}) with no ad, partner or referral marker.` };
  }
  return null;
}

function compare(a: Touch, b: Touch): number {
  const dt = Date.parse(a.at) - Date.parse(b.at);
  if (Math.abs(dt) > SIMULTANEOUS_MS) return dt;
  return RANK[a.kind] - RANK[b.kind] || dt;
}

export function attribute(input: AttributionInput, ctx: AttributionContext): Attribution {
  const touches: Touch[] = [];
  const own = { source: text(input.leadAttribution, "source"), externalId: text(input.leadAttribution, "externalId") };

  const first = touchFromRaw({ at: input.createdAt, source: own.source ?? null, leadSource: input.leadSource, attribution: input.leadAttribution }, ctx, input.clientId);
  if (first) touches.push(first);

  for (const row of input.intakes) {
    if (own.source && own.externalId && row.source === own.source && row.externalId === own.externalId) continue; // the row that created the lead
    const t = touchFromRaw({ at: row.at, source: row.source, leadSource: row.leadSource, attribution: row.attribution }, ctx, input.clientId);
    if (t) touches.push(t);
  }
  if (input.partner) {
    touches.push({ kind: "partner_code", at: input.partner.at.toISOString(), campaign: null, creative: null, form: null, code: input.partner.code, confidence: "high", rule: "verified_partner_code", why: `Signed up with partner code ${input.partner.code}, which exists in the partner table (${input.partner.source}).` });
  }
  if (input.referral) {
    const code = input.referral.code;
    touches.push({ kind: "referral_code", at: input.referral.at.toISOString(), campaign: null, creative: null, form: null, code, confidence: "high", rule: "attributed_referral", why: `Joined through a customer referral${code ? ` (code ${code})` : ""} that the referral programme attributed.` });
  }

  if (touches.length === 0) {
    const label = input.leadSource?.trim();
    const conflicting = Boolean(text(input.leadAttribution, "fbclid") && text(input.leadAttribution, "gclid"));
    if (conflicting) return { status: "unattributed", first: null, last: null, touches: [], confidence: null, reason: "conflicting_markers", reasonText: "The lead carries both a Meta and a Google click id, so neither channel is credited." };
    if (label && !input.leadAttribution) return { status: "unattributed", first: null, last: null, touches: [], confidence: null, reason: "manual_source", reasonText: `Entered with the source "${label}" and no campaign, form or code details, so nothing can be credited.` };
    return { status: "unattributed", first: null, last: null, touches: [], confidence: null, reason: "no_markers", reasonText: label ? `The "${label}" lead carried no campaign, form or code details.` : "Nothing in the record says where this customer came from." };
  }

  touches.sort(compare);
  const earliest = Date.parse(touches[0].at);
  const firstTouch = touches.filter((t) => Date.parse(t.at) - earliest <= SIMULTANEOUS_MS).sort((a, b) => RANK[a.kind] - RANK[b.kind])[0];

  const cutoff = input.fundedAt ? input.fundedAt.getTime() : Number.POSITIVE_INFINITY;
  const eligible = touches.filter((t) => Date.parse(t.at) <= cutoff);
  const pool = eligible.length > 0 ? eligible : [touches[0]];
  const latest = Math.max(...pool.map((t) => Date.parse(t.at)));
  const lastTouch = pool.filter((t) => latest - Date.parse(t.at) <= SIMULTANEOUS_MS).sort((a, b) => RANK[a.kind] - RANK[b.kind])[0];

  return { status: "attributed", first: firstTouch, last: lastTouch, touches, confidence: firstTouch.confidence, reason: null, reasonText: null };
}

export type Group = { key: string; label: string; kind: "campaign" | "source" | "unattributed" };

const SOURCE_LABEL: Record<string, string> = {
  "meta:unknown": "Meta ads, campaign not identified",
  "google:unknown": "Google ads, campaign not identified",
  partner_code: "Partner codes",
  referral_code: "Referral codes",
  form: "Website forms",
  organic: "Organic sign-ups",
};

/** What a touch is counted under in a campaign table: its campaign, or a named source bucket, or Unattributed. */
export function groupOf(touch: Touch | null): Group {
  if (!touch) return { key: "unattributed", label: "Unattributed", kind: "unattributed" };
  if (touch.campaign) return { key: touch.campaign.key, label: touch.campaign.name ?? touch.campaign.id ?? "Unnamed campaign", kind: "campaign" };
  const key = touch.kind === "meta_ad" ? "meta:unknown" : touch.kind === "google_ad" ? "google:unknown" : touch.kind;
  return { key, label: SOURCE_LABEL[key], kind: "source" };
}

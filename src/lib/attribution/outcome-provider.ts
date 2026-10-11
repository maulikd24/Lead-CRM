import { canAccessMarketing } from "@/lib/access/marketing-access";

import type { ImpactReport, ImpactRow, SpendFreshness } from "./impact";

/**
 * CampaignOutcomeProvider: THE way any module reads what marketing brought in. Spend, leads, contacted in time, KYC, funded customers and revenue,
 * by campaign, ad (creative) and period, each with its data age and a confidence label. Autopilot, creative intelligence, the planner, closed-loop
 * conversions and director reports read it from here and never compute their own funded, contacted or cost-per-lead numbers (a boundary test
 * fails the build when one declares its own provider or reads ad spend tables). This file is Prisma-free: the interface, the definitions, the
 * access rule, the confidence rule and the mapping from the attribution model. The database side is outcome-provider-db.ts.
 *
 * What it returns is aggregates. Never a name, a customer id, an RM, an answer a lead typed: a consumer that needs to look at one customer asks
 * the Customer 360 Journey, which has its own access rules.
 */

/** The only definitions of each number. A module that shows a different one is wrong, not different. */
export const OUTCOME_DEFINITIONS = {
  spend: "Ad spend the platform reported for the campaign (or ad) in the period, in the ad account currency. Not shown when none was synced or another currency would have to be added.",
  leads: "Customers whose FIRST touch is this campaign (or ad), created in the period.",
  contactedInSla: "Leads a person of ours reached (a connected call, a logged contact or meeting, or a message a person sent) within the speed-to-lead SLA. Rate = of the leads whose window has closed.",
  kyc: "Leads whose KYC is approved.",
  funded: "Leads with a successful funds-in payment, or a partly or fully funded funding record.",
  revenue: "Net brokerage and advisory revenue to date from those customers, INR, reversals netted off.",
  costPerLead: "Spend divided by leads, only for a campaign that has spend.",
  costPerFunded: "Spend divided by funded customers, only for a campaign that has spend.",
  roas: "Revenue to date divided by spend, only for a campaign that has spend.",
} as const;

/** Registered system readers (jobs and engines that run without a signed-in person). Anything else is refused. */
export const OUTCOME_CONSUMERS = ["autopilot", "creative", "planner", "closed-loop", "director-reports", "control-plane"] as const;
export type OutcomeConsumer = (typeof OUTCOME_CONSUMERS)[number];

export type OutcomeCaller = { kind: "user"; id: string; role: string } | { kind: "system"; consumer: OutcomeConsumer };

export class OutcomeAccessError extends Error {
  constructor(message = "Not allowed to read campaign outcomes") {
    super(message);
    this.name = "OutcomeAccessError";
  }
}

export type OutcomeGrain = "campaign" | "adset" | "ad";
export type OutcomePeriod = { from: string; to: string };
export type OutcomeChannel = "meta" | "google";
export type OutcomeQuery = { grain: OutcomeGrain; period: OutcomePeriod; channel?: OutcomeChannel; campaignKey?: string };

export type ConfidenceLabel = "high" | "medium" | "low" | "insufficient";
export type OutcomeConfidence = { label: ConfidenceLabel; reasons: string[] };

/** Defaults, not facts: they are labelled as configurable and every label says why it was given. */
export const CONFIDENCE_DEFAULTS = { minLeads: 10, minHighShare: 0.6, lowShareCeiling: 0.5 } as const;

export type ConfidenceInput = { leads: number; high: number; medium: number; low: number; spendKnown: boolean; spendStale: boolean; spendPartial: boolean };

export function labelConfidence(i: ConfidenceInput): OutcomeConfidence {
  const reasons: string[] = [];
  if (i.leads < CONFIDENCE_DEFAULTS.minLeads) return { label: "insufficient", reasons: [`Only ${i.leads} lead${i.leads === 1 ? "" : "s"}: at least ${CONFIDENCE_DEFAULTS.minLeads} are needed before a rate means anything (default, configurable).`] };
  let label: ConfidenceLabel = "high";
  const lower = (to: ConfidenceLabel) => {
    const order: ConfidenceLabel[] = ["insufficient", "low", "medium", "high"];
    if (order.indexOf(to) < order.indexOf(label)) label = to;
  };
  if (!i.spendKnown) { lower("low"); reasons.push("No spend figure for this campaign, so cost and return cannot be shown."); }
  if (i.spendStale) { lower("medium"); reasons.push("Spend has not been updated recently, so the latest days may be missing and cost may look lower than it is."); }
  if (i.spendPartial) { lower("medium"); reasons.push("Spend covers only some days of the period."); }
  const classified = i.high + i.medium + i.low;
  if (classified > 0) {
    if (i.low / classified > CONFIDENCE_DEFAULTS.lowShareCeiling) { lower("low"); reasons.push("Most of these leads are credited to the campaign on weak evidence."); }
    else if (i.high / classified < CONFIDENCE_DEFAULTS.minHighShare) { lower("medium"); reasons.push("Fewer than 60% of these leads are credited on strong evidence (default, configurable)."); }
  }
  if (reasons.length === 0) reasons.push("Enough leads, strong attribution and fresh spend.");
  return { label, reasons };
}

export type OutcomeRow = {
  key: string;
  grain: OutcomeGrain;
  /** campaign: a campaign; source: partner, referral or website bucket; unattributed: no usable marker. Only campaigns can have spend. */
  rowKind: "campaign" | "source" | "unattributed";
  label: string;
  channel: OutcomeChannel | null;
  /** The campaign key an ad row belongs to. */
  campaignKey: string | null;
  spend: number | null;
  currency: string;
  leads: number;
  /** null: not computed at this grain (per ad), never zero. */
  contactedInSla: number | null;
  late: number | null;
  missed: number | null;
  contactedInSlaRate: number | null;
  kyc: number | null;
  funded: number;
  revenue: number;
  costPerLead: number | null;
  costPerFunded: number | null;
  roas: number | null;
  confidence: OutcomeConfidence;
};

export type OutcomeTotals = { leads: number; spend: number | null; costPerLead: number | null; kyc: number; funded: number; revenue: number; roas: number | null; contactedInSlaRate: number | null; late: number; missed: number };

export type SpendAge = { channel: OutcomeChannel; label: string; lastSyncAt: string | null; ageLabel: string | null; status: "fresh" | "stale" | "partial" | "missing"; coveredDays: number; expectedDays: number; messages: string[] };
export type DataAge = { asOf: string; spend: SpendAge[] };

/** The four channels a director report blends. Website forms, organic and unattributed customers belong to none of them. */
export type OutcomeChannelKey = "meta" | "google" | "partner" | "referral";
export const OUTCOME_CHANNELS: readonly OutcomeChannelKey[] = ["meta", "google", "partner", "referral"];
/** One channel's totals. Cost per funded customer and return use only the campaigns that have spend. Null is "not known", never zero. */
export type ChannelOutcome = { channel: OutcomeChannelKey; label: string; available: boolean; spend: number | null; leads: number | null; kyc: number | null; funded: number | null; revenue: number | null; costPerFunded: number | null; roas: number | null };

/** Meta and Google together. */
export type PaidOutcome = Omit<ChannelOutcome, "channel" | "label">;

export type OutcomeReport = {
  provider: string;
  grain: OutcomeGrain;
  period: OutcomePeriod;
  supported: boolean;
  unsupportedReason?: string;
  currency: string;
  rows: OutcomeRow[];
  totals: OutcomeTotals | null;
  unattributedShare: number | null;
  /** Totals per channel for the whole period (not narrowed by the query's channel or campaign). */
  byChannel: ChannelOutcome[];
  /** The two ad channels together (the figure a director's total cost per funded customer and return come from). */
  paid: PaidOutcome;
  dataAge: DataAge;
  notes: string[];
  /** The lead window was cut at its limit: figures cover the most recent leads only. */
  truncated: boolean;
  definitions: typeof OUTCOME_DEFINITIONS;
};

export interface CampaignOutcomeProvider {
  readonly name: string;
  outcomes(query: OutcomeQuery, caller: OutcomeCaller): Promise<OutcomeReport>;
}

/** What an implementation loads for one period: the model's impact report and the spend freshness per channel. Aggregates. */
export type OutcomeSource = {
  load: (period: OutcomePeriod) => Promise<{ report: ImpactReport; freshness: { channel: OutcomeChannel; label: string; value: SpendFreshness }[]; truncated: boolean }>;
  now?: () => Date;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const ADSET_UNSUPPORTED = "Outcomes by ad set are not available: ad platforms are synced at campaign level (and ad level for Google), so spend cannot be split by ad set without guessing.";

function assertCaller(caller: OutcomeCaller): void {
  if (caller.kind === "system") {
    if (!(OUTCOME_CONSUMERS as readonly string[]).includes(caller.consumer)) throw new OutcomeAccessError(`"${String(caller.consumer)}" is not a registered reader of campaign outcomes`);
    return;
  }
  if (!canAccessMarketing(caller.role)) throw new OutcomeAccessError();
}

function assertPeriod(p: OutcomePeriod): void {
  if (!p || !YMD.test(p.from) || !YMD.test(p.to) || p.from > p.to) throw new Error("A valid period is required: from and to as YYYY-MM-DD, from not after to.");
}

function ageOf(f: { channel: OutcomeChannel; label: string; value: SpendFreshness }): SpendAge {
  const v = f.value;
  const status: SpendAge["status"] = !v.lastSuccessAt && v.coveredDays === 0 ? "missing" : v.stale ? "stale" : v.partial ? "partial" : "fresh";
  return { channel: f.channel, label: f.label, lastSyncAt: v.lastSuccessAt ? v.lastSuccessAt.toISOString() : null, ageLabel: v.ageLabel, status, coveredDays: v.coveredDays, expectedDays: v.expectedDays, messages: v.messages };
}

const rate = (a: number, b: number): number | null => (b > 0 && Number.isFinite(a / b) ? a / b : null);

function campaignRow(r: ImpactRow, currency: string, age: SpendAge | undefined): OutcomeRow {
  const spendApplies = r.kind === "campaign";
  const confidence = labelConfidence({ leads: r.leads, ...r.confidence, spendKnown: spendApplies ? r.spendKnown : true, spendStale: spendApplies && age?.status === "stale", spendPartial: spendApplies && age?.status === "partial" });
  if (spendApplies && age?.status === "stale" && age.ageLabel) confidence.reasons.push(`Spend was last updated ${age.ageLabel}.`);
  return {
    key: r.key, grain: "campaign", rowKind: r.kind, label: r.label, channel: r.channel, campaignKey: r.kind === "campaign" ? r.key : null,
    spend: r.spend, currency, leads: r.leads, contactedInSla: r.contactedInSla, late: r.late, missed: r.missed, contactedInSlaRate: r.contactedInSlaRate,
    kyc: r.kyc, funded: r.funded, revenue: r.revenue, costPerLead: r.cpl, costPerFunded: r.costPerFunded, roas: r.roas, confidence,
  };
}

function adRows(r: ImpactRow, currency: string, age: SpendAge | undefined): OutcomeRow[] {
  if (r.kind !== "campaign") return [];
  return r.creatives.map((c) => {
    const spendKnown = c.spend !== null;
    const confidence = labelConfidence({ leads: c.leads, ...r.confidence, spendKnown, spendStale: spendKnown && age?.status === "stale", spendPartial: spendKnown && age?.status === "partial" });
    confidence.reasons.push("Attribution evidence is that of the whole campaign; contact and KYC are not computed per ad.");
    return {
      key: `${r.key}::${c.name}`, grain: "ad" as const, rowKind: "campaign" as const, label: c.name, channel: r.channel, campaignKey: r.key,
      spend: c.spend, currency, leads: c.leads, contactedInSla: null, late: null, missed: null, contactedInSlaRate: null, kyc: null, funded: c.funded, revenue: c.revenue,
      costPerLead: c.cpl, costPerFunded: c.spend !== null ? rate(c.spend, c.funded) : null, roas: c.spend !== null && c.revenue > 0 ? rate(c.revenue, c.spend) : null, confidence,
    };
  });
}

const CHANNEL_LABEL: Record<OutcomeChannelKey, string> = { meta: "Meta", google: "Google", partner: "Partners", referral: "Referrals" };
const channelOfRow = (r: ImpactRow): OutcomeChannelKey | null => (r.channel === "meta" || r.channel === "google" ? r.channel : r.key === "partner_code" ? "partner" : r.key === "referral_code" ? "referral" : null);

function summarise(rows: ImpactRow[], available: boolean, currency: string): PaidOutcome {
  if (!available) return { available: false, spend: null, leads: null, kyc: null, funded: null, revenue: null, costPerFunded: null, roas: null };
  const spent = rows.filter((r) => r.kind === "campaign" && r.spend !== null);
  const spend = spent.length ? spent.reduce((a, r) => a + (r.spend ?? 0), 0) : null;
  const spentFunded = spent.reduce((a, r) => a + r.funded, 0);
  const spentRevenue = spent.reduce((a, r) => a + r.revenue, 0);
  return {
    available: true, spend,
    leads: rows.reduce((a, r) => a + r.leads, 0), kyc: rows.reduce((a, r) => a + r.kyc, 0), funded: rows.reduce((a, r) => a + r.funded, 0), revenue: rows.reduce((a, r) => a + r.revenue, 0),
    costPerFunded: spend !== null ? rate(spend, spentFunded) : null,
    roas: spend !== null && currency === "INR" && spentRevenue > 0 ? rate(spentRevenue, spend) : null,
  };
}

/** Channel totals from the attribution model's rows: the only place a channel's cost per funded customer and return are computed. */
function channelOutcomes(report: ImpactReport, ages: SpendAge[]): { byChannel: ChannelOutcome[]; paid: PaidOutcome } {
  const isAdChannel = (c: OutcomeChannelKey) => c === "meta" || c === "google";
  const availableOf = (c: OutcomeChannelKey, rows: ImpactRow[]) => {
    const age = ages.find((a) => a.channel === c);
    return rows.length > 0 || (isAdChannel(c) && !!age && age.status !== "missing");
  };
  const byChannel = OUTCOME_CHANNELS.map((channel): ChannelOutcome => {
    const rows = report.rows.filter((r) => channelOfRow(r) === channel);
    return { channel, label: CHANNEL_LABEL[channel], ...summarise(rows, availableOf(channel, rows), report.currency) };
  });
  const adRows = report.rows.filter((r) => { const c = channelOfRow(r); return c === "meta" || c === "google"; });
  return { byChannel, paid: summarise(adRows, byChannel.some((c) => isAdChannel(c.channel) && c.available), report.currency) };
}

/** The one implementation of the interface over a source of attribution aggregates. The database provider and the test provider differ only in the source. */
export function createOutcomeProvider(source: OutcomeSource, name = "attribution"): CampaignOutcomeProvider {
  return {
    name,
    async outcomes(query, caller) {
      assertCaller(caller);
      assertPeriod(query.period);
      const now = (source.now ?? (() => new Date()))();
      const loaded = await source.load(query.period);
      const ages = loaded.freshness.map(ageOf);
      const dataAge: DataAge = { asOf: now.toISOString(), spend: ages };
      const notes = [...loaded.report.notes];
      if (loaded.truncated) notes.push("The lead window reached its limit (the first 5000 leads of the period were read), so figures cover the most recent leads only.");
      const { byChannel, paid } = channelOutcomes(loaded.report, ages);
      const base = { provider: name, grain: query.grain, period: query.period, currency: loaded.report.currency, dataAge, notes, byChannel, paid, truncated: loaded.truncated, definitions: OUTCOME_DEFINITIONS };

      if (query.grain === "adset") return { ...base, supported: false, unsupportedReason: ADSET_UNSUPPORTED, rows: [], totals: null, unattributedShare: null };

      const ageFor = (channel: OutcomeChannel | null) => (channel ? ages.find((a) => a.channel === channel) : undefined);
      let source_rows = loaded.report.rows;
      if (query.channel) source_rows = source_rows.filter((r) => r.channel === query.channel);
      if (query.campaignKey) source_rows = source_rows.filter((r) => r.key === query.campaignKey);
      const rows = query.grain === "ad" ? source_rows.flatMap((r) => adRows(r, loaded.report.currency, ageFor(r.channel))) : source_rows.map((r) => campaignRow(r, loaded.report.currency, ageFor(r.channel)));

      const t = loaded.report.totals;
      const narrowed = Boolean(query.channel || query.campaignKey);
      const totals: OutcomeTotals | null = narrowed ? null : { leads: t.leads, spend: t.spend, costPerLead: t.cpl, kyc: t.kyc, funded: t.funded, revenue: t.revenue, roas: t.roas, contactedInSlaRate: t.contactedInSlaRate, late: t.late, missed: t.missed };
      return { ...base, supported: true, rows, totals: query.grain === "campaign" ? totals : null, unattributedShare: loaded.report.unattributedShare };
    },
  };
}

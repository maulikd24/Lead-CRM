import { attributeLeads, type AdIdentity, type LeadRecord, type UnattributedReason } from "./attribution";
import { addDays, dayDiff } from "./dates";
import { currencyExponent } from "./money";

/**
 * Turns synced ad spend plus CRM outcomes into the numbers the Marketing page shows. Pure.
 *
 * Formulas (all per campaign and in total):
 *   spend         sum of the platform-reported daily spend in range, in major units of the account currency
 *   Meta leads    leads the platform reports for those days (can lag, can include leads the CRM rejected)
 *   CRM leads     distinct Meta-sourced leads CREATED in the range that the CRM received and matched to the campaign
 *   CPL           spend / CRM leads              (CPL on Meta leads is shown alongside as "Meta CPL")
 *   KYC rate      KYC approved / CRM leads
 *   cost per KYC  spend / KYC approved
 *   cost per funded customer   spend / funded customers
 *   funded AUM    current portfolio value of those customers (latest holdings snapshot per account)
 *   AUM per rupee funded AUM / spend              (INR accounts only)
 *   ROAS          brokerage and fee revenue booked for those customers / spend   (INR accounts only)
 * Outcomes are a COHORT view: they follow the leads created in the range wherever those customers are today, so recent
 * ranges look worse than they will once those leads have had time to fund.
 */

export type AdDayRow = {
  campaignId: string;
  campaignName: string;
  date: string;
  /** Minor units (paise, cents), as stored. */
  spendMinor: number;
  currency: string;
  impressions: number;
  clicks: number;
  reach: number;
  leads: number;
};

export type OutcomeLead = LeadRecord & {
  kycApproved: boolean;
  funded: boolean;
  firstTransaction: boolean;
  /** Current portfolio value in INR. */
  aum: number;
  /** Revenue booked for the customer, in INR. */
  revenue: number;
};

export type QualityKey = "inactive" | "no_leads" | "tracking_gap" | "early" | "cheap_no_funded" | "no_funded" | "efficient" | "on_par" | "expensive";
export type QualityTone = "success" | "warning" | "destructive" | "neutral";
export type Quality = { key: QualityKey; label: string; detail: string; tone: QualityTone };

export const MIN_LEADS_FOR_VERDICT = 10;
const MIN_IMPRESSIONS_FOR_NO_LEADS = 1000;
const EFFICIENT_RATIO = 0.75;
const EXPENSIVE_RATIO = 1.5;
const TRACKING_GAP_RATIO = 0.5;

const div = (a: number, b: number): number | null => (b > 0 && Number.isFinite(a / b) ? a / b : null);

type Ratios = { cpl: number | null; costPerFunded: number | null };
type QualityInput = { spend: number; impressions: number; metaLeads: number; crmLeads: number; funded: number; cpl: number | null; costPerFunded: number | null };

export function classifyCampaign(row: QualityInput, benchmark: Ratios): Quality {
  if (row.spend <= 0 && row.crmLeads === 0 && row.metaLeads === 0) {
    return { key: "inactive", label: "No spend", detail: "Nothing was spent on this campaign in the range.", tone: "neutral" };
  }
  if (row.metaLeads === 0 && row.crmLeads === 0) {
    return row.impressions >= MIN_IMPRESSIONS_FOR_NO_LEADS
      ? { key: "no_leads", label: "Spending, no leads", detail: "Money was spent and the ads were shown, but no leads came in.", tone: "warning" }
      : { key: "early", label: "Too early to judge", detail: "Too little delivery so far to say anything.", tone: "neutral" };
  }
  if (row.metaLeads >= MIN_LEADS_FOR_VERDICT && row.crmLeads < row.metaLeads * TRACKING_GAP_RATIO) {
    return { key: "tracking_gap", label: "Leads not reaching the CRM", detail: "Meta reports far more leads than the CRM received or could match. Check lead delivery and campaign naming before judging this campaign.", tone: "warning" };
  }
  if (row.crmLeads < MIN_LEADS_FOR_VERDICT) {
    return { key: "early", label: "Too early to judge", detail: `Fewer than ${MIN_LEADS_FOR_VERDICT} leads so far; the numbers will move.`, tone: "neutral" };
  }
  if (row.funded === 0) {
    const cheap = row.cpl !== null && benchmark.cpl !== null && row.cpl <= benchmark.cpl;
    return cheap
      ? { key: "cheap_no_funded", label: "Cheap leads, none funded", detail: "Lead cost is at or below average, but none of these leads has funded an account yet. The audience may not be the right one.", tone: "warning" }
      : { key: "no_funded", label: "No funded customers yet", detail: "Lead cost is above average and none of these leads has funded an account yet.", tone: "destructive" };
  }
  const ratio = row.costPerFunded !== null && benchmark.costPerFunded ? row.costPerFunded / benchmark.costPerFunded : null;
  if (ratio !== null && ratio <= EFFICIENT_RATIO) return { key: "efficient", label: "Efficient", detail: "Each funded customer costs well under the account average.", tone: "success" };
  if (ratio !== null && ratio >= EXPENSIVE_RATIO) return { key: "expensive", label: "Expensive per funded customer", detail: "Each funded customer costs well over the account average.", tone: "destructive" };
  return { key: "on_par", label: "On par", detail: "Cost per funded customer is close to the account average.", tone: "neutral" };
}

export type CampaignRow = {
  campaignId: string;
  name: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  reach: number;
  metaLeads: number;
  crmLeads: number;
  kyc: number;
  funded: number;
  firstTransaction: number;
  aum: number;
  revenue: number;
  cpl: number | null;
  cplMeta: number | null;
  kycRate: number | null;
  costPerKyc: number | null;
  costPerFunded: number | null;
  aumPerRupee: number | null;
  roas: number | null;
  quality: Quality;
  /** Daily spend across the range, for the inline bars. */
  spark: number[];
};

export type Totals = Omit<CampaignRow, "campaignId" | "name" | "quality" | "spark">;
export type FunnelStep = { key: "impressions" | "clicks" | "leads" | "kyc" | "funded"; label: string; value: number; rateFromPrevious: number | null };
export type DayPoint = { date: string; spend: number; metaLeads: number; crmLeads: number; funded: number; cpl: number | null };

export type ReportNote = { tone: "neutral" | "warning"; text: string };

export type MarketingReport = {
  range: { from: string; to: string };
  currency: string | null;
  totals: Totals;
  funnel: FunnelStep[];
  campaigns: CampaignRow[];
  unattributed: { leads: number; kyc: number; funded: number; aum: number; reasons: Record<UnattributedReason, number> };
  daily: DayPoint[];
  excluded: { nonMeta: number; duplicates: number; otherCurrencyRows: number };
  notes: ReportNote[];
};

type Acc = { crmLeads: number; kyc: number; funded: number; firstTransaction: number; aum: number; revenue: number };
const emptyAcc = (): Acc => ({ crmLeads: 0, kyc: 0, funded: 0, firstTransaction: 0, aum: 0, revenue: 0 });
function addLead(acc: Acc, l: OutcomeLead) {
  acc.crmLeads++;
  if (l.kycApproved) acc.kyc++;
  if (l.funded) acc.funded++;
  if (l.firstTransaction) acc.firstTransaction++;
  acc.aum += l.aum;
  acc.revenue += l.revenue;
}

/** The currency with the most rows in range; a tie goes to the larger total minor-unit spend. */
function pickCurrency(rows: AdDayRow[]): string | null {
  const stats = new Map<string, { rows: number; minor: number }>();
  for (const r of rows) {
    const s = stats.get(r.currency) ?? { rows: 0, minor: 0 };
    s.rows++;
    s.minor += r.spendMinor;
    stats.set(r.currency, s);
  }
  return [...stats.entries()].sort((a, b) => b[1].rows - a[1].rows || b[1].minor - a[1].minor)[0]?.[0] ?? null;
}

type CampaignAcc = { name: string; spendMinor: number; impressions: number; clicks: number; reach: number; metaLeads: number; spark: number[]; lastDate: string; acc: Acc };

export function buildReport(input: { from: string; to: string; adHistoryStart?: string | null; ads: AdDayRow[]; identities: AdIdentity[]; leads: OutcomeLead[] }): MarketingReport {
  const { to } = input;
  const notes: ReportNote[] = [];
  // Spend before the first synced day is unknown, and comparing it with leads from those days would understate every cost.
  const start = input.adHistoryStart ?? null;
  const from = start && input.from < start ? start : input.from;
  if (start && input.from < start) notes.push({ tone: "warning", text: `Spend is only available from ${start}; cost metrics cover that period.` });
  const dayCount = Math.max(0, dayDiff(from, to) + 1);
  const dates = Array.from({ length: dayCount }, (_, i) => addDays(from, i));
  const dateIndex = new Map(dates.map((d, i) => [d, i]));

  const inRange = input.ads.filter((r) => r.date >= from && r.date <= to);
  const currency = pickCurrency(inRange);
  const adsInRange = inRange.filter((r) => r.currency === currency);
  const otherCurrencyRows = inRange.length - adsInRange.length;
  const exponent = currency ? currencyExponent(currency) : 2;
  const major = (minor: number) => minor / 10 ** exponent;
  const spendKey = dates.map(() => 0); // daily minor-unit totals, summed as integers
  if (otherCurrencyRows > 0) notes.push({ tone: "warning", text: `${otherCurrencyRows} ad rows in a currency other than ${currency} were left out, because amounts in different currencies cannot be added.` });
  const inr = currency === "INR";
  if (currency && !inr) notes.push({ tone: "neutral", text: "AUM and revenue are held in INR, so AUM per rupee and ROAS are not shown for an account billed in another currency." });

  // Identities and activity come from every ad row passed in (the lead-in days help break name ties).
  const cohort = input.leads.filter((l) => l.day >= from && l.day <= to);
  const { assignments, excluded } = attributeLeads(
    cohort,
    input.identities,
    input.ads.map((r) => ({ campaignId: r.campaignId, date: r.date })),
  );

  const byCampaign = new Map<string, CampaignAcc>();
  const ensure = (id: string, name: string): CampaignAcc => {
    let c = byCampaign.get(id);
    if (!c) {
      c = { name, spendMinor: 0, impressions: 0, clicks: 0, reach: 0, metaLeads: 0, spark: dates.map(() => 0), lastDate: "", acc: emptyAcc() };
      byCampaign.set(id, c);
    }
    return c;
  };

  const daily: DayPoint[] = dates.map((date) => ({ date, spend: 0, metaLeads: 0, crmLeads: 0, funded: 0, cpl: null }));
  for (const r of adsInRange) {
    const c = ensure(r.campaignId, r.campaignName);
    c.spendMinor += r.spendMinor;
    c.impressions += r.impressions;
    c.clicks += r.clicks;
    c.reach += r.reach;
    c.metaLeads += r.leads;
    const i = dateIndex.get(r.date);
    if (i !== undefined) {
      c.spark[i] += r.spendMinor;
      spendKey[i] += r.spendMinor;
      daily[i].metaLeads += r.leads;
    }
    if (r.date >= c.lastDate) {
      c.lastDate = r.date;
      c.name = r.campaignName; // the most recent name wins when a campaign was renamed
    }
  }

  const total = emptyAcc();
  const unattributed = { leads: 0, kyc: 0, funded: 0, aum: 0, reasons: { no_campaign_info: 0, no_match: 0, ambiguous_campaign_name: 0 } as Record<UnattributedReason, number> };
  const names = new Map(input.identities.map((i) => [i.campaignId, i.campaignName]));
  for (const a of assignments) {
    const l = a.lead;
    addLead(total, l);
    const i = dateIndex.get(l.day);
    if (i !== undefined) {
      daily[i].crmLeads++;
      if (l.funded) daily[i].funded++;
    }
    if (a.campaignId) {
      addLead(ensure(a.campaignId, names.get(a.campaignId) ?? a.campaignId).acc, l);
    } else {
      unattributed.leads++;
      if (l.kycApproved) unattributed.kyc++;
      if (l.funded) unattributed.funded++;
      unattributed.aum += l.aum;
      if (a.reason) unattributed.reasons[a.reason]++;
    }
  }
  daily.forEach((d, i) => {
    d.spend = major(spendKey[i]);
    d.cpl = div(d.spend, d.crmLeads);
  });

  const metricsFor = (spend: number, impressions: number, clicks: number, reach: number, metaLeads: number, acc: Acc): Totals => ({
    spend,
    impressions,
    clicks,
    ctr: div(clicks, impressions),
    reach,
    metaLeads,
    crmLeads: acc.crmLeads,
    kyc: acc.kyc,
    funded: acc.funded,
    firstTransaction: acc.firstTransaction,
    aum: acc.aum,
    revenue: acc.revenue,
    cpl: div(spend, acc.crmLeads),
    cplMeta: div(spend, metaLeads),
    kycRate: div(acc.kyc, acc.crmLeads),
    costPerKyc: div(spend, acc.kyc),
    costPerFunded: div(spend, acc.funded),
    aumPerRupee: inr && acc.aum > 0 ? div(acc.aum, spend) : null,
    // Zero revenue shows as "no value" rather than 0x: it cannot be told apart from revenue that has not been loaded yet.
    roas: inr && acc.revenue > 0 ? div(acc.revenue, spend) : null,
  });

  let spendMinor = 0;
  let impressions = 0;
  let clicks = 0;
  let reach = 0;
  let metaLeads = 0;
  for (const c of byCampaign.values()) {
    spendMinor += c.spendMinor;
    impressions += c.impressions;
    clicks += c.clicks;
    reach += c.reach;
    metaLeads += c.metaLeads;
  }
  const totals = metricsFor(major(spendMinor), impressions, clicks, reach, metaLeads, total);
  const benchmark: Ratios = { cpl: totals.cpl, costPerFunded: totals.costPerFunded };

  const campaigns: CampaignRow[] = [...byCampaign.entries()]
    .map(([campaignId, c]) => {
      const m = metricsFor(major(c.spendMinor), c.impressions, c.clicks, c.reach, c.metaLeads, c.acc);
      return { campaignId, name: c.name, ...m, quality: classifyCampaign(m, benchmark), spark: c.spark.map(major) };
    })
    .sort((a, b) => b.spend - a.spend || b.crmLeads - a.crmLeads);

  const step = (key: FunnelStep["key"], label: string, value: number, prev: number | null): FunnelStep => ({ key, label, value, rateFromPrevious: prev === null ? null : div(value, prev) });
  const funnel: FunnelStep[] = [
    step("impressions", "Impressions", totals.impressions, null),
    step("clicks", "Clicks", totals.clicks, totals.impressions),
    step("leads", "Leads", totals.crmLeads, totals.clicks),
    step("kyc", "KYC approved", totals.kyc, totals.crmLeads),
    step("funded", "Funded", totals.funded, totals.crmLeads),
  ];

  if (totals.metaLeads > 0 && totals.crmLeads < totals.metaLeads * TRACKING_GAP_RATIO) {
    notes.push({ tone: "neutral", text: "Meta reports far more leads than the CRM received. Counts can differ for honest reasons (duplicates, leads still being processed, rejected forms) but a gap this large deserves a look." });
  }
  return { range: { from, to }, currency, totals, funnel, campaigns, unattributed, daily, excluded: { ...excluded, otherCurrencyRows }, notes };
}

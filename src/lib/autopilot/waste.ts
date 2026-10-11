import { totalsByCampaign, totalSpend } from "./derive";
import { DEFAULT_THRESHOLDS, type Thresholds } from "./thresholds";
import { inr, sum } from "./stats";
import type { AutopilotSnapshot } from "./types";

/**
 * Wasted spend by cause. Each rupee is counted under at most one cause, in the fixed order below, so the causes
 * add up and never exceed total spend. A cause whose data the platforms did not report is "not available", never 0.
 */

export const WASTE_CAUSES = [
  { key: "zero_funded", label: "Zero-funded campaigns", how: "All spend of a campaign that brought enough leads (default 30) and not one funded customer." },
  { key: "irrelevant_terms", label: "Irrelevant search terms", how: "Spend on search terms containing words that signal no intent to invest (a default list), with no lead." },
  { key: "low_quality_keywords", label: "Low-quality keywords", how: "Spend on keywords with a low platform quality score (default 4 or below) and no lead." },
  { key: "junk_placements", label: "Junk placements", how: "Spend on placements on a default junk list, or with enough spend and no lead." },
  { key: "zero_lead_hours", label: "Zero-lead hours", how: "Spend in hours of the week that spent enough to judge and brought no conversion." },
  { key: "audience_overlap", label: "Audience overlap", how: "Estimate: the smaller campaign's spend times the audience overlap, where two campaigns reach the same people." },
  { key: "budget_capped", label: "Budget-capped campaigns", how: "In campaigns that run out of budget, the spend above what the same leads would cost at the account's median cost per lead." },
] as const;
export type WasteKey = (typeof WASTE_CAUSES)[number]["key"];

export type WasteCause = {
  key: WasteKey;
  label: string;
  how: string;
  available: boolean;
  amount: number;
  /** Share of total spend, 0..1; null when not available. */
  share: number | null;
  /** The biggest items, for the evidence line. */
  top: string[];
};

export type WasteReport = { totalSpend: number; wasted: number; wastedShare: number | null; causes: WasteCause[] };

export function wastedSpend(s: AutopilotSnapshot, t: Thresholds = DEFAULT_THRESHOLDS): WasteReport {
  const total = totalSpend(s);
  const totals = totalsByCampaign(s);
  const claimed = new Set<string>(); // campaigns whose whole spend is already counted
  const out: WasteCause[] = [];
  const add = (key: WasteKey, available: boolean, items: { label: string; amount: number }[]) => {
    const meta = WASTE_CAUSES.find((c) => c.key === key)!;
    const amount = available ? sum(items.map((i) => i.amount)) : 0;
    const top = [...items].sort((a, b) => b.amount - a.amount).slice(0, 3).filter((i) => i.amount > 0).map((i) => `${i.label}: ${inr(i.amount)}`);
    out.push({ key, label: meta.label, how: meta.how, available, amount, share: available && total > 0 ? amount / total : available ? 0 : null, top });
  };

  // 1. Zero-funded campaigns
  const zf = totals.filter((c) => c.spend >= t.minSpend && c.crmLeads >= t.minLeads && c.funded === 0);
  zf.forEach((c) => claimed.add(c.campaign.id));
  add("zero_funded", s.leads.length > 0, zf.map((c) => ({ label: c.campaign.name, amount: c.spend })));

  // 2. Irrelevant search terms
  const irrelevant = (term: string) => t.irrelevantTermWords.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(term));
  add("irrelevant_terms", !!s.searchTerms, (s.searchTerms ?? []).filter((r) => !claimed.has(r.campaignId) && r.leads === 0 && irrelevant(r.term)).map((r) => ({ label: `"${r.term}"`, amount: r.spend })));

  // 3. Low-quality keywords
  add("low_quality_keywords", !!s.keywords, (s.keywords ?? []).filter((r) => !claimed.has(r.campaignId) && r.leads === 0 && r.qualityScore !== null && r.qualityScore <= t.qualityScoreLow).map((r) => ({ label: `"${r.keyword}"`, amount: r.spend })));

  // 4. Junk placements
  const junk = (p: string) => t.junkPlacementWords.some((w) => p.toLowerCase().includes(w));
  add("junk_placements", !!s.placements, (s.placements ?? []).filter((r) => !claimed.has(r.campaignId) && r.leads === 0 && (junk(r.placement) ? r.spend > 0 : r.spend >= t.minSpend)).map((r) => ({ label: r.placement, amount: r.spend })));

  // 5. Zero-lead hours: sum hour cells per (dow, hour) across campaigns, judge the cell.
  const cell = new Map<string, { spend: number; conv: number }>();
  for (const r of (s.hours ?? []).filter((h) => !claimed.has(h.campaignId))) {
    const k = `${r.dow}-${r.hour}`;
    const c = cell.get(k) ?? { spend: 0, conv: 0 };
    c.spend += r.spend; c.conv += r.conversions; cell.set(k, c);
  }
  const hourMinSpend = t.minSpend / 5; // a cell is a sliver of the week, so it needs less spend to count
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  add("zero_lead_hours", !!s.hours, [...cell].filter(([, c]) => c.conv === 0 && c.spend >= hourMinSpend).map(([k, c]) => { const [d, h] = k.split("-").map(Number); return { label: `${DAYS[d]} ${String(h).padStart(2, "0")}:00`, amount: c.spend }; }));

  // 6. Audience overlap: the smaller campaign's spend x overlap, once per campaign.
  const spendOf = new Map(totals.map((c) => [c.campaign.id, c.spend]));
  const overlapItems: { label: string; amount: number }[] = [];
  const seen = new Set<string>();
  for (const o of [...(s.audienceOverlap ?? [])].sort((a, b) => b.overlapPct - a.overlapPct)) {
    const a = spendOf.get(o.campaignA) ?? 0, b = spendOf.get(o.campaignB) ?? 0;
    const small = a <= b ? o.campaignA : o.campaignB;
    if (claimed.has(small) || seen.has(small)) continue;
    seen.add(small);
    overlapItems.push({ label: `${s.campaigns.find((c) => c.id === small)?.name ?? small} (${Math.round(o.overlapPct * 100)}% overlap)`, amount: Math.min(a, b) * o.overlapPct });
  }
  add("audience_overlap", !!s.audienceOverlap, overlapItems);

  // 7. Budget-capped campaigns: spend above the median-CPL price of the leads they did get.
  const cpls = totals.map((c) => c.cpl).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const medCpl = cpls.length ? cpls[Math.floor(cpls.length / 2)] : null;
  const capped = totals.filter((c) => !claimed.has(c.campaign.id) && (c.campaign.lostImpressionShareBudget ?? 0) > 0.1 && c.spend >= t.minSpend && c.platformLeads > 0);
  add("budget_capped", totals.some((c) => c.campaign.lostImpressionShareBudget != null) && medCpl !== null, capped.map((c) => ({ label: c.campaign.name, amount: Math.max(0, c.spend - c.platformLeads * (medCpl ?? 0)) })));

  // Never let the causes exceed total spend (they are built not to, but a data quirk must not break the sum).
  let wasted = sum(out.map((c) => c.amount));
  if (wasted > total && wasted > 0) {
    const k = total / wasted;
    for (const c of out) { c.amount *= k; c.share = total > 0 ? c.amount / total : 0; }
    wasted = total;
  }
  return { totalSpend: total, wasted, wastedShare: total > 0 ? wasted / total : null, causes: out };
}

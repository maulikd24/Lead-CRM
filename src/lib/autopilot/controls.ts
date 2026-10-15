import { dataAgeText, nameOf, totalsByCampaign, totalSpend, unattributed } from "./derive";
import { monthlyPacing } from "./pacing";
import { DEFAULT_THRESHOLDS, type Thresholds } from "./thresholds";
import { inr, median, pct, ratio, sum } from "./stats";
import { timingReport } from "./timing";
import { trackingIntegrity } from "./tracking";
import { wastedSpend } from "./waste";
import type { AutopilotSnapshot, Category, ControlResult, ControlState, Severity } from "./types";

/** The control library. Each control reads the snapshot and says pass, fail or unknown, with the numbers behind it. */

type Out = { state: ControlState; finding: string; evidence?: string[]; campaignIds?: string[] };
type Ctl = { id: string; category: Category; severity: Severity; run: (s: AutopilotSnapshot, t: Thresholds) => Out };

const unk = (finding: string): Out => ({ state: "unknown", finding });
const names = (s: AutopilotSnapshot, ids: string[]) => ids.slice(0, 3).map((i) => nameOf(s, i)).join(", ") + (ids.length > 3 ? ` and ${ids.length - 3} more` : "");

const CONTROLS: Ctl[] = [
  // Keywords
  { id: "KW1", category: "Keywords", severity: "high", run: (s, t) => {
    if (!s.keywords) return unk("Keyword data is not reported yet.");
    const spend = sum(s.keywords.map((k) => k.spend)); if (spend < t.minSpend) return unk("Too little keyword spend to judge.");
    const low = s.keywords.filter((k) => k.qualityScore !== null && k.qualityScore <= t.qualityScoreLow);
    const share = sum(low.map((k) => k.spend)) / spend;
    return share > 0.2 ? { state: "fail", finding: `${pct(share)} of keyword spend goes to keywords with a low quality score, which makes clicks cost more.`, evidence: [`${low.length} keywords at quality score ${t.qualityScoreLow} or below (default)`, `${inr(sum(low.map((k) => k.spend)))} of ${inr(spend)}`] } : { state: "pass", finding: "Few keywords have a low quality score.", evidence: [`${pct(share)} of keyword spend (default limit 20%)`] };
  } },
  { id: "KW2", category: "Keywords", severity: "medium", run: (s, t) => {
    if (!s.keywords) return unk("Keyword data is not reported yet.");
    const dead = s.keywords.filter((k) => k.spend >= t.minSpend / 2 && k.leads === 0);
    return dead.length ? { state: "fail", finding: `${dead.length} keywords have spent real money and brought no lead.`, evidence: [`${inr(sum(dead.map((k) => k.spend)))} spent with no lead`, ...dead.slice(0, 2).map((k) => `"${k.keyword}": ${inr(k.spend)}`)] } : { state: "pass", finding: "Every keyword with meaningful spend has produced a lead." };
  } },
  // Ad quality
  { id: "AQ1", category: "Ad quality", severity: "medium", run: (s, t) => {
    const bad = totalsByCampaign(s).filter((c) => c.impressions >= t.minImpressions && c.ctr !== null && c.ctr < t.lowCtr);
    const judged = totalsByCampaign(s).filter((c) => c.impressions >= t.minImpressions);
    if (!judged.length) return unk("Not enough impressions to judge click-through.");
    return bad.length ? { state: "fail", finding: `${bad.length} campaign(s) get few clicks for their impressions, so the ads may not be catching attention.`, evidence: bad.slice(0, 3).map((c) => `${c.campaign.name}: ${pct(c.ctr as number, 2)} click-through (default floor ${pct(t.lowCtr, 1)})`), campaignIds: bad.map((c) => c.campaign.id) } : { state: "pass", finding: "Click-through is above the default floor everywhere it can be judged.", evidence: [`${judged.length} campaigns judged`] };
  } },
  { id: "AQ2", category: "Ad quality", severity: "medium", run: (s, t) => {
    const bad = totalsByCampaign(s).filter((c) => c.clicks >= t.minClicks && c.clickToLead !== null && c.clickToLead < t.lowClickToLead);
    const judged = totalsByCampaign(s).filter((c) => c.clicks >= t.minClicks);
    if (!judged.length) return unk("Not enough clicks to judge how many become leads.");
    return bad.length ? { state: "fail", finding: `${bad.length} campaign(s) turn very few clicks into leads.`, evidence: bad.slice(0, 3).map((c) => `${c.campaign.name}: ${pct(c.clickToLead as number, 2)} of clicks become a lead (default floor ${pct(t.lowClickToLead)})`), campaignIds: bad.map((c) => c.campaign.id) } : { state: "pass", finding: "Clicks turn into leads at a healthy rate.", evidence: [`${judged.length} campaigns judged`] };
  } },
  // Conversions and tracking
  { id: "CT1", category: "Conversions and tracking", severity: "critical", run: (s, t) => {
    const r = trackingIntegrity(s, t); if (!r.available) return unk("Tracking signals are not connected yet.");
    const bad = r.findings.filter((f) => f.kind === "missing_event");
    return bad.length ? { state: "fail", finding: bad[0].message, evidence: bad.map((f) => `${f.subject} (${f.platform}): ${f.evidence[0]}`) } : { state: "pass", finding: "Every event the closed loop needs fired in the last 7 days." };
  } },
  { id: "CT2", category: "Conversions and tracking", severity: "high", run: (s, t) => {
    const r = trackingIntegrity(s, t); if (!r.available) return unk("Tracking signals are not connected yet.");
    const bad = r.findings.filter((f) => f.kind === "duplicate_firing" || f.kind === "no_dedup_id");
    return bad.length ? { state: "fail", finding: bad[0].message, evidence: bad.flatMap((f) => f.evidence).slice(0, 4) } : { state: "pass", finding: "No sign of conversions being counted twice." };
  } },
  { id: "CT3", category: "Conversions and tracking", severity: "high", run: (s, t) => {
    const r = trackingIntegrity(s, t); if (!r.available) return unk("Tracking signals are not connected yet.");
    if (s.tracking!.offlineImports.length === 0) return { state: "not_applicable", finding: "No offline-conversion import is set up." };
    const bad = r.findings.filter((f) => f.kind.startsWith("import"));
    return bad.length ? { state: "fail", finding: bad[0].message, evidence: bad.flatMap((f) => f.evidence).slice(0, 4) } : { state: "pass", finding: "Offline-conversion uploads are arriving and being accepted." };
  } },
  // Budget and pacing
  { id: "BP1", category: "Budget and pacing", severity: "high", run: (s, t) => {
    const rows = monthlyPacing(s, s.window.until, t).filter((r) => r.flag !== "no_plan" && r.flag !== "no_data");
    if (!rows.length) return unk("No campaign has a monthly plan to pace against.");
    if (rows.every((r) => r.flag === "too_early")) return unk("Too early in the month to judge pacing.");
    const bad = rows.filter((r) => r.flag === "overspend" || r.flag === "underspend");
    return bad.length ? { state: "fail", finding: `${bad.length} campaign(s) are on course to miss their monthly plan.`, evidence: bad.slice(0, 3).map((r) => `${r.campaignName}: projected ${inr(r.projected as number)} against a plan of ${inr(r.planned as number)}`), campaignIds: bad.map((r) => r.campaignId) } : { state: "pass", finding: "Every planned campaign is on track for its monthly budget." };
  } },
  { id: "BP2", category: "Budget and pacing", severity: "medium", run: (s) => {
    const known = s.campaigns.filter((c) => c.lostImpressionShareBudget != null);
    if (!known.length) return unk("The platforms have not reported impressions lost to budget.");
    const bad = known.filter((c) => (c.lostImpressionShareBudget ?? 0) > 0.1);
    return bad.length ? { state: "fail", finding: `${bad.length} campaign(s) run out of budget and miss searches they could have won.`, evidence: bad.slice(0, 3).map((c) => `${c.name}: ${pct(c.lostImpressionShareBudget as number)} of impressions lost to budget`), campaignIds: bad.map((c) => c.id) } : { state: "pass", finding: "No campaign loses much reach to its budget." };
  } },
  { id: "BP3", category: "Budget and pacing", severity: "medium", run: (s) => {
    const active = s.campaigns.filter((c) => c.status === "ACTIVE"); if (!active.length) return unk("No active campaign is known.");
    const idle = totalsByCampaign(s).filter((c) => c.campaign.status === "ACTIVE" && c.spend === 0);
    return idle.length ? { state: "fail", finding: `${idle.length} campaign(s) marked active have spent nothing in this period.`, evidence: [names(s, idle.map((c) => c.campaign.id))], campaignIds: idle.map((c) => c.campaign.id) } : { state: "pass", finding: "Every active campaign is spending." };
  } },
  // Structure
  { id: "ST1", category: "Structure", severity: "medium", run: (s) => {
    const tt = totalsByCampaign(s).filter((c) => c.spend > 0); if (tt.length < 2) return { state: "not_applicable", finding: "Only one campaign is running." };
    const thin = tt.filter((c) => c.platformLeads < 10);
    return thin.length / tt.length > 0.5 ? { state: "fail", finding: "Most campaigns get too few leads for the platform to learn from; consider fewer, larger campaigns.", evidence: [`${thin.length} of ${tt.length} campaigns under 10 leads in the period (default)`] } : { state: "pass", finding: "Campaigns are large enough to learn from.", evidence: [`${tt.length - thin.length} of ${tt.length} campaigns have 10 or more leads`] };
  } },
  { id: "ST2", category: "Structure", severity: "informational", run: (s) => {
    const noPlan = s.campaigns.filter((c) => c.plannedMonthlyBudget === null);
    return noPlan.length ? { state: "fail", finding: `${noPlan.length} campaign(s) have no planned monthly budget, so pacing cannot be checked.`, evidence: [names(s, noPlan.map((c) => c.id))] } : { state: "pass", finding: "Every campaign has a planned budget." };
  } },
  // Targeting
  { id: "TG1", category: "Targeting", severity: "high", run: (s) => {
    const known = s.campaigns.filter((c) => c.geoCountries); if (!known.length) return unk("Targeted countries are not reported.");
    const bad = known.filter((c) => (c.geoCountries ?? []).some((g) => g !== "IN"));
    return bad.length ? { state: "fail", finding: `${bad.length} campaign(s) target outside India; leads from there cannot be served.`, evidence: bad.slice(0, 3).map((c) => `${c.name}: ${(c.geoCountries ?? []).join(", ")}`), campaignIds: bad.map((c) => c.id) } : { state: "pass", finding: "All campaigns target India only." };
  } },
  // Bidding
  { id: "BD1", category: "Bidding", severity: "critical", run: (s, t) => {
    const target = s.settings.targetCostPerFunded; if (target === null) return unk("No target cost per funded customer is set.");
    const tt = totalsByCampaign(s).filter((c) => c.spend >= t.minSpend && c.crmLeads >= t.minLeads);
    if (!tt.length) return unk("Not enough leads in any campaign to judge cost per funded customer.");
    const bad = tt.filter((c) => c.costPerFunded === null || c.costPerFunded > target);
    return bad.length ? { state: "fail", finding: `${bad.length} campaign(s) cost more per funded customer than your target.`, evidence: bad.slice(0, 3).map((c) => `${c.campaign.name}: ${c.costPerFunded === null ? "no funded customer yet" : inr(c.costPerFunded)} against a target of ${inr(target)}`), campaignIds: bad.map((c) => c.campaign.id) } : { state: "pass", finding: "Every judged campaign is within the target cost per funded customer." };
  } },
  { id: "BD2", category: "Bidding", severity: "medium", run: (s, t) => {
    const out: { name: string; prev: number; now: number }[] = [];
    const last = s.window.until; const cut = (n: number) => new Date(Date.parse(last) - n * 86_400_000).toISOString().slice(0, 10);
    let judged = 0;
    for (const c of s.campaigns) {
      const rows = s.days.filter((d) => d.campaignId === c.id);
      const a = rows.filter((d) => d.date > cut(7)), b = rows.filter((d) => d.date <= cut(7) && d.date > cut(14));
      const la = sum(a.map((d) => d.leads)), lb = sum(b.map((d) => d.leads));
      if (la < 5 || lb < 5) continue; judged++;
      const now = sum(a.map((d) => d.spend)) / la, prev = sum(b.map((d) => d.spend)) / lb;
      if (now > prev * (1 + t.cplRiseRatio)) out.push({ name: c.name, prev, now });
    }
    if (!judged) return unk("Not enough leads in the last two weeks to compare cost per lead.");
    return out.length ? { state: "fail", finding: `Cost per lead rose sharply in ${out.length} campaign(s) this week.`, evidence: out.slice(0, 3).map((o) => `${o.name}: ${inr(o.prev)} to ${inr(o.now)} per lead`) } : { state: "pass", finding: "Cost per lead is steady week on week." };
  } },
  // Landing page
  { id: "LP1", category: "Landing page", severity: "high", run: (s) => {
    const known = s.campaigns.filter((c) => c.landingUrl !== undefined); if (!known.length) return unk("Landing pages are not reported.");
    const bad = known.filter((c) => !c.landingUrl || !/^https:\/\//i.test(c.landingUrl));
    return bad.length ? { state: "fail", finding: `${bad.length} campaign(s) have no secure (https) landing page.`, evidence: [names(s, bad.map((c) => c.id))], campaignIds: bad.map((c) => c.id) } : { state: "pass", finding: "Every campaign sends people to a secure landing page." };
  } },
  { id: "LP2", category: "Landing page", severity: "medium", run: (s, t) => {
    const leads = s.leads.filter((l) => l.campaignId); if (leads.length < t.minLeads) return unk(`Only ${leads.length} attributed leads (default needs ${t.minLeads}) to judge how fast they are called.`);
    const within = leads.filter((l) => l.contactMinutes !== null && l.contactMinutes <= s.settings.contactSlaMinutes).length / leads.length;
    return within < t.contactSlaShareFail ? { state: "fail", finding: "Too many ad leads are not called within the promised time, so paid clicks go cold.", evidence: [`${pct(within)} contacted within ${s.settings.contactSlaMinutes} minutes (default floor ${pct(t.contactSlaShareFail)})`, `median first contact ${Math.round(median(leads.filter((l) => l.contactMinutes !== null).map((l) => l.contactMinutes as number)) ?? 0)} min`] } : { state: "pass", finding: "Ad leads are called within the promised time.", evidence: [`${pct(within)} within ${s.settings.contactSlaMinutes} minutes`] };
  } },
  // Attribution
  { id: "AT1", category: "Attribution", severity: "high", run: (s, t) => {
    if (s.leads.length < t.minLeads) return unk(`Only ${s.leads.length} leads (default needs ${t.minLeads}).`);
    const share = unattributed(s.leads).length / s.leads.length;
    return share > t.unattributedShareFail ? { state: "fail", finding: "Too many leads cannot be traced to a campaign, so their cost is invisible.", evidence: [`${pct(share)} of ${s.leads.length} leads have no campaign (default limit ${pct(t.unattributedShareFail)})`] } : { state: "pass", finding: "Most leads can be traced to a campaign.", evidence: [`${pct(share)} unattributed`] };
  } },
  { id: "AT2", category: "Attribution", severity: "medium", run: (s, t) => {
    const tt = totalsByCampaign(s).filter((c) => c.platformLeads >= 20 && c.crmLeads > 0); if (!tt.length) return unk("Not enough leads to compare the platforms with the CRM.");
    const bad = tt.filter((c) => Math.abs(c.platformLeads - c.crmLeads) / c.platformLeads > t.platformCrmGap);
    return bad.length ? { state: "fail", finding: "The ad platform and the CRM disagree on how many leads some campaigns brought.", evidence: bad.slice(0, 3).map((c) => `${c.campaign.name}: platform ${c.platformLeads}, CRM ${c.crmLeads}`), campaignIds: bad.map((c) => c.campaign.id) } : { state: "pass", finding: "Platform and CRM lead counts agree." };
  } },
  // Schedule
  { id: "SC1", category: "Schedule", severity: "medium", run: (s, t) => {
    if (!s.hours?.length) return unk("Spend by hour is not reported yet.");
    const w = wastedSpend(s, t).causes.find((c) => c.key === "zero_lead_hours")!;
    return (w.share ?? 0) > 0.05 ? { state: "fail", finding: "Some hours of the week spend money and bring nothing.", evidence: [`${inr(w.amount)} (${pct(w.share ?? 0, 1)} of spend) in zero-lead hours`, ...w.top.slice(0, 2)] } : { state: "pass", finding: "No hour of the week spends much without result." };
  } },
  { id: "SC2", category: "Schedule", severity: "informational", run: (s, t) => {
    const r = timingReport(s, t);
    return r.recommendations.length ? { state: "fail", finding: r.recommendations[0].headline + ".", evidence: r.recommendations[0].evidence } : r.leadsUsed < t.bandMinLeads * 2 ? unk("Not enough leads to say anything about time of day.") : { state: "pass", finding: "No time of day stands out as clearly better or worse." };
  } },
  // Placement
  { id: "PL1", category: "Placement", severity: "medium", run: (s, t) => {
    if (!s.placements) return unk("Placement data is not reported yet.");
    const w = wastedSpend(s, t).causes.find((c) => c.key === "junk_placements")!;
    return (w.share ?? 0) > 0.05 ? { state: "fail", finding: "Money is going to placements that bring no leads.", evidence: [`${inr(w.amount)} (${pct(w.share ?? 0, 1)} of spend)`, ...w.top.slice(0, 2)] } : { state: "pass", finding: "Little spend goes to placements without leads." };
  } },
  // Creatives
  { id: "CR1", category: "Creatives", severity: "medium", run: (s, t) => {
    if (!s.adFatigue) return unk("Per-ad history is not reported yet.");
    const bad = s.adFatigue.filter((a) => a.impressionsLast7 >= t.minImpressions && ((a.ctrPrior14 > 0 && a.ctrLast7 < a.ctrPrior14 * (1 - t.fatigueCtrDrop)) || (a.frequency ?? 0) > t.fatigueFrequency));
    return bad.length ? { state: "fail", finding: `${bad.length} ad(s) look tired: fewer people click than before.`, evidence: bad.slice(0, 3).map((a) => `${a.adName}: click-through ${pct(a.ctrPrior14, 2)} to ${pct(a.ctrLast7, 2)}`), campaignIds: [...new Set(bad.map((a) => a.campaignId))] } : { state: "pass", finding: "No ad shows signs of fatigue." };
  } },
  { id: "CR2", category: "Creatives", severity: "informational", run: (s) => {
    if (!s.adFatigue) return unk("Per-ad history is not reported yet.");
    const per = new Map<string, number>(); for (const a of s.adFatigue) per.set(a.campaignId, (per.get(a.campaignId) ?? 0) + 1);
    const thin = [...per].filter(([, n]) => n < 3);
    return thin.length ? { state: "fail", finding: `${thin.length} campaign(s) run fewer than 3 ads, leaving nothing to test against.`, evidence: thin.slice(0, 3).map(([id, n]) => `${nameOf(s, id)}: ${n} ads`) } : { state: "pass", finding: "Every campaign has 3 or more ads." };
  } },
  // Negatives
  { id: "NG1", category: "Negatives", severity: "high", run: (s, t) => {
    if (!s.searchTerms) return unk("Search terms are not reported yet.");
    const w = wastedSpend(s, t).causes.find((c) => c.key === "irrelevant_terms")!;
    return (w.share ?? 0) > 0.03 ? { state: "fail", finding: "Ads are showing for searches that are not about investing.", evidence: [`${inr(w.amount)} (${pct(w.share ?? 0, 1)} of spend) on irrelevant terms`, ...w.top.slice(0, 2)] } : { state: "pass", finding: "Little spend goes to irrelevant searches." };
  } },
  { id: "NG2", category: "Negatives", severity: "medium", run: (s) => {
    const g = s.campaigns.filter((c) => c.platform === "google"); if (!g.length) return { state: "not_applicable", finding: "No Google search campaign." };
    const known = g.filter((c) => c.negativeKeywordCount != null); if (!known.length) return unk("Negative keyword lists are not reported.");
    const none = known.filter((c) => (c.negativeKeywordCount ?? 0) === 0);
    return none.length ? { state: "fail", finding: `${none.length} Google campaign(s) have no negative keywords at all.`, evidence: [names(s, none.map((c) => c.id))], campaignIds: none.map((c) => c.id) } : { state: "pass", finding: "Every Google campaign has negative keywords." };
  } },
  // Audience
  { id: "AU1", category: "Audience", severity: "medium", run: (s, t) => {
    if (!s.audienceOverlap) return unk("Audience overlap is not reported yet.");
    const bad = s.audienceOverlap.filter((o) => o.overlapPct > t.audienceOverlapFail);
    return bad.length ? { state: "fail", finding: "Some campaigns bid for the same people against each other.", evidence: bad.slice(0, 3).map((o) => `${nameOf(s, o.campaignA)} and ${nameOf(s, o.campaignB)}: ${pct(o.overlapPct)} overlap (default limit ${pct(t.audienceOverlapFail)})`), campaignIds: bad.flatMap((o) => [o.campaignA, o.campaignB]) } : { state: "pass", finding: "Campaign audiences do not overlap much." };
  } },
  { id: "AU2", category: "Audience", severity: "high", run: (s) => {
    const known = s.campaigns.filter((c) => c.excludesExistingCustomers != null); if (!known.length) return unk("Customer exclusions are not reported.");
    const bad = known.filter((c) => !c.excludesExistingCustomers);
    return bad.length ? { state: "fail", finding: `${bad.length} campaign(s) do not exclude existing customers, so you pay to reach people who already bank with you.`, evidence: [names(s, bad.map((c) => c.id))], campaignIds: bad.map((c) => c.id) } : { state: "pass", finding: "Existing customers are excluded everywhere." };
  } },
];

export function evaluateControls(s: AutopilotSnapshot, t: Thresholds = DEFAULT_THRESHOLDS): ControlResult[] {
  return CONTROLS.map((c) => {
    let out: Out;
    try { out = c.run(s, t); } catch { out = unk("This check could not run on the data available."); }
    return { id: c.id, category: c.category, severity: c.severity, state: out.state, finding: out.finding, evidence: out.evidence ?? [], campaignIds: out.campaignIds };
  });
}

/** Footnote the UI shows next to every score. */
export function provenance(s: AutopilotSnapshot): string {
  return `Data ${dataAgeText(s)}. Total spend in view: ${inr(totalSpend(s))}. Thresholds are defaults and can be changed.`;
}
export { ratio };

import { checkContent } from "@/lib/marketing/social/compliance";
import { DEFAULT_THRESHOLDS, type Thresholds } from "./thresholds";
import { pct, percentile, ratio, round, sum, wilson } from "./stats";
import { timingReport } from "./timing";
import type { AutopilotSnapshot, Platform } from "./types";

/**
 * Campaign launch drafts. The assistant turns an objective, a budget and an audience into a DRAFT with estimates built
 * from OUR OWN past funnel, never from industry averages. Estimates are ranges, labelled as estimates, with the
 * assumptions shown. A draft is created PAUSED; turning it on is a separate human act (see actions.ts).
 */

export type LaunchInput = {
  name: string;
  objective: "funded_customers" | "leads";
  platform: Platform;
  /** Total budget for the run, major units. */
  totalBudget: number;
  days: number;
  audience: { description: string; ageMin?: number; ageMax?: number; usesCustomerList?: boolean };
  geo: { kind: "states" | "cities" | "radius"; values: string[]; radiusKm?: number };
  landingUrl: string;
  copy: { headline: string; body: string };
};

export type Range = { low: number; high: number };
export type Estimates =
  | { available: true; clicks: Range; leads: Range; funded: Range; assumptions: string[]; label: string }
  | { available: false; reason: string; needed: string[] };

export type ChecklistItem = { label: string; state: "pass" | "fail" | "manual"; detail: string };

export type LaunchDraft = {
  input: LaunchInput;
  dailyBudget: number;
  schedule: { startsPaused: true; days: string; hours: string; source: string };
  bidding: { strategy: string; note: string };
  estimates: Estimates;
  checklist: ChecklistItem[];
  /** True only when every automatic check passes; manual items still need a person. */
  complianceClear: boolean;
  errors: string[];
};

/** Our own funnel, measured from the snapshot. */
export type Funnel = {
  cpc: Range | null;
  clickToLead: { rate: number; low: number; high: number; n: number } | null;
  leadToFunded: { rate: number; low: number; high: number; n: number } | null;
};

export function historicalFunnel(s: AutopilotSnapshot, platform: Platform, t: Thresholds = DEFAULT_THRESHOLDS): Funnel {
  const ids = new Set(s.campaigns.filter((c) => c.platform === platform).map((c) => c.id));
  const days = s.days.filter((d) => ids.has(d.campaignId));
  const clicks = sum(days.map((d) => d.clicks));
  const leads = sum(days.map((d) => d.leads));
  const cpcs = days.filter((d) => d.clicks >= 10).map((d) => d.spend / d.clicks);
  const crm = s.leads.filter((l) => l.campaignId && ids.has(l.campaignId));
  const c2l = clicks >= t.minClicks ? wilson(leads, clicks, 0.8) : null;
  const l2f = crm.length >= t.minLeads ? wilson(crm.filter((l) => l.funded).length, crm.length, 0.8) : null;
  return {
    cpc: cpcs.length >= 5 ? { low: percentile(cpcs, 0.1) as number, high: percentile(cpcs, 0.9) as number } : null,
    clickToLead: c2l ? { rate: leads / clicks, ...c2l, n: clicks } : null,
    leadToFunded: l2f ? { rate: crm.filter((l) => l.funded).length / crm.length, ...l2f, n: crm.length } : null,
  };
}

export function estimate(input: LaunchInput, f: Funnel): Estimates {
  const needed: string[] = [];
  if (!f.cpc) needed.push("at least 5 days of click costs on this platform");
  if (!f.clickToLead) needed.push("at least 100 clicks on this platform");
  if (!f.leadToFunded) needed.push("at least 30 attributed leads on this platform");
  if (!f.cpc || !f.clickToLead || !f.leadToFunded) return { available: false, reason: "Not enough of our own history on this platform to estimate honestly.", needed };
  const clicks = { low: Math.floor(input.totalBudget / f.cpc.high), high: Math.ceil(input.totalBudget / f.cpc.low) };
  const leads = { low: Math.floor(clicks.low * f.clickToLead.low), high: Math.ceil(clicks.high * f.clickToLead.high) };
  const funded = { low: Math.floor(leads.low * f.leadToFunded.low), high: Math.ceil(leads.high * f.leadToFunded.high) };
  return {
    available: true, clicks, leads, funded,
    label: "Estimate, not a promise. Ranges are wide on purpose: they multiply the uncertainty of each step.",
    assumptions: [
      `Cost per click ${round(f.cpc.low, 1)} to ${round(f.cpc.high, 1)} rupees (our 10th to 90th percentile day on this platform)`,
      `${pct(f.clickToLead.low, 1)} to ${pct(f.clickToLead.high, 1)} of clicks become a lead (80% interval from ${f.clickToLead.n} past clicks)`,
      `${pct(f.leadToFunded.low, 1)} to ${pct(f.leadToFunded.high, 1)} of leads become funded customers (80% interval from ${f.leadToFunded.n} past leads)`,
      "Assumes the same audience quality, copy quality and contact speed as recent campaigns",
    ],
  };
}

const RISK = /subject\s+to\s+market\s+risks?/i;

export function checklistFor(input: LaunchInput): ChecklistItem[] {
  const text = `${input.copy.headline}\n${input.copy.body}`;
  const content = checkContent({ channel: "facebook", body: text });
  const bad = (codes: string[]) => content.issues.filter((i) => codes.includes(i.code));
  const row = (label: string, issues: { message: string }[]): ChecklistItem => ({ label, state: issues.length ? "fail" : "pass", detail: issues.length ? issues.map((i) => i.message).join(" ") : "No problem found by the automatic check." });
  const items: ChecklistItem[] = [
    row("No promised or guaranteed returns", bad(["RETURN_PROMISE", "PERFORMANCE_CLAIM"])),
    row("No personal investment advice", bad(["ADVICE"])),
    row("No pressure or urgency wording", bad(["URGENCY"])),
    row("No unverifiable claims (best, safest, number one)", bad(["SUPERLATIVE", "HYPE"])),
    row("No unfinished [placeholders]", bad(["PLACEHOLDER"])),
    row("Copy is present and within length", bad(["EMPTY", "TOO_LONG"])),
    { label: "Market-risk statement in the copy or on the landing page", state: RISK.test(text) ? "pass" : "manual", detail: RISK.test(text) ? "Found in the copy." : "Not in the copy: confirm it appears on the landing page, or add it." },
    { label: "Landing page is a secure (https) address", state: /^https:\/\//i.test(input.landingUrl) ? "pass" : "fail", detail: /^https:\/\//i.test(input.landingUrl) ? "Yes." : "The address must start with https://." },
    { label: "Registration line and mandatory disclosures confirmed by Compliance", state: "manual", detail: "A person confirms the wording; Autopilot never fills in registration numbers." },
    { label: "Ad-approval annexure signed by the authorised signatory", state: "manual", detail: "Required before the campaign can be turned on." },
  ];
  if (input.audience.usesCustomerList) items.push({ label: "Customer-list audience uses only customers who consented to ad measurement", state: "manual", detail: "Confirm the consent purpose covers it before any list is uploaded." });
  return items;
}

export function buildLaunchDraft(input: LaunchInput, s: AutopilotSnapshot, t: Thresholds = DEFAULT_THRESHOLDS): LaunchDraft {
  const errors: string[] = [];
  if (!input.name.trim()) errors.push("Give the campaign a name.");
  if (!(input.totalBudget > 0)) errors.push("Enter a budget above zero.");
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 90) errors.push("Days must be between 1 and 90.");
  if (input.geo.values.length === 0) errors.push("Choose where the ads should run.");
  if (input.geo.kind === "radius" && !(input.geo.radiusKm && input.geo.radiusKm > 0)) errors.push("Give a radius in kilometres.");
  if (input.audience.ageMin && input.audience.ageMax && input.audience.ageMin > input.audience.ageMax) errors.push("Minimum age is above maximum age.");
  const checklist = checklistFor(input);
  const timing = timingReport(s, t);
  const cut = timing.recommendations.find((r) => r.kind === "reduce_ads_in_band");
  const hoursText = cut ? `All hours except ${timing.bands.find((b) => b.key === cut.band)?.label}` : "All hours";
  const funnel = historicalFunnel(s, input.platform, t);
  return {
    input,
    dailyBudget: input.days > 0 ? round(input.totalBudget / input.days, 0) : 0,
    schedule: { startsPaused: true, days: "Every day", hours: hoursText, source: cut ? "Our lead-arrival history shows weak results in that band (see Timing)" : "No time-of-day evidence strong enough to restrict hours" },
    bidding: { strategy: "Lowest cost for leads, no cap", note: "Add a cost cap only after about 30 conversions, so the platform has something to learn from." },
    estimates: estimate(input, funnel),
    checklist, complianceClear: checklist.every((c) => c.state !== "fail"),
    errors,
  };
}
export { ratio };

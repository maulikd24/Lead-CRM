import { localParts } from "./derive";
import { DEFAULT_THRESHOLDS, type Thresholds } from "./thresholds";
import { median, pct, ratio, sum, wilson } from "./stats";
import type { AutopilotSnapshot, LeadRecord } from "./types";

/**
 * Performance by day and hour. Two views: what the ad platform reports (conversions and spend by weekday and hour),
 * and what only we can see: how fast leads were contacted and how many were funded, by the hour the lead ARRIVED.
 * A recommendation is made only when a time band has enough leads; otherwise it says how many more it needs.
 */

export type HeatCell = { dow: number; hour: number; conversions: number; spend: number };
export type HourStat = { hour: number; leads: number; funded: number; fundedRate: number | null; medianContactMinutes: number | null };

/** Time bands of the firm's day. "overnight" wraps midnight. */
export const BANDS = [
  { key: "overnight", label: "9pm-7am", hours: [21, 22, 23, 0, 1, 2, 3, 4, 5, 6] },
  { key: "morning", label: "7am-12pm", hours: [7, 8, 9, 10, 11] },
  { key: "afternoon", label: "12pm-5pm", hours: [12, 13, 14, 15, 16] },
  { key: "evening", label: "5pm-9pm", hours: [17, 18, 19, 20] },
] as const;
export type BandKey = (typeof BANDS)[number]["key"];

export type BandStat = {
  key: BandKey;
  label: string;
  leads: number;
  funded: number;
  fundedRate: number | null;
  /** Upper end of a 90% interval for the funded rate: what the true rate could be at most. */
  fundedRateHigh: number | null;
  medianContactMinutes: number | null;
  withinSlaShare: number | null;
  uncontactedShare: number | null;
};

export type TimingRecommendation = {
  kind: "reduce_ads_in_band" | "staff_band";
  band: BandKey;
  headline: string;
  evidence: string[];
};
export type TimingHold = { band: BandKey; leads: number; needed: number; message: string };

export type TimingReport = {
  heat: { available: boolean; cells: HeatCell[] };
  hours: HourStat[];
  bands: BandStat[];
  recommendations: TimingRecommendation[];
  /** Bands that look interesting but lack the sample to say anything. */
  holds: TimingHold[];
  leadsUsed: number;
};

const bandOf = (hour: number): BandKey => BANDS.find((b) => (b.hours as readonly number[]).includes(hour))!.key;

function stat(leads: LeadRecord[], sla: number) {
  const funded = leads.filter((l) => l.funded).length;
  const contacted = leads.filter((l) => l.contactMinutes !== null).map((l) => l.contactMinutes as number);
  return {
    leads: leads.length,
    funded,
    fundedRate: ratio(funded, leads.length),
    medianContactMinutes: median(contacted),
    withinSlaShare: ratio(contacted.filter((m) => m <= sla).length, leads.length),
    uncontactedShare: ratio(leads.length - contacted.length, leads.length),
  };
}

export function timingReport(s: AutopilotSnapshot, t: Thresholds = DEFAULT_THRESHOLDS): TimingReport {
  const sla = s.settings.contactSlaMinutes;
  const heatMap = new Map<string, HeatCell>();
  for (const r of s.hours ?? []) {
    const k = `${r.dow}-${r.hour}`;
    const c = heatMap.get(k) ?? { dow: r.dow, hour: r.hour, conversions: 0, spend: 0 };
    c.conversions += r.conversions; c.spend += r.spend; heatMap.set(k, c);
  }
  const withHour = s.leads.map((l) => ({ l, hour: localParts(l.arrivedAt, s.settings.tzOffsetMinutes).hour }));
  const hours: HourStat[] = Array.from({ length: 24 }, (_, hour) => {
    const st = stat(withHour.filter((x) => x.hour === hour).map((x) => x.l), sla);
    return { hour, leads: st.leads, funded: st.funded, fundedRate: st.fundedRate, medianContactMinutes: st.medianContactMinutes };
  });
  const bands: BandStat[] = BANDS.map((b) => {
    const inBand = withHour.filter((x) => bandOf(x.hour) === b.key).map((x) => x.l);
    const st = stat(inBand, sla);
    return { key: b.key, label: b.label, ...st, fundedRateHigh: wilson(st.funded, st.leads, 0.9)?.high ?? null };
  });

  const recommendations: TimingRecommendation[] = [];
  const holds: TimingHold[] = [];
  for (const b of bands) {
    const rest = withHour.filter((x) => bandOf(x.hour) !== b.key).map((x) => x.l);
    const restStat = stat(rest, sla);
    const weak = (b.fundedRate !== null && restStat.fundedRate !== null && b.fundedRate < restStat.fundedRate) ||
      (b.medianContactMinutes !== null && restStat.medianContactMinutes !== null && b.medianContactMinutes > 1.5 * restStat.medianContactMinutes) ||
      (b.withinSlaShare !== null && restStat.withinSlaShare !== null && b.withinSlaShare < restStat.withinSlaShare - 0.1);
    if (b.leads < t.bandMinLeads) {
      if (weak && b.leads > 0) holds.push({ band: b.key, leads: b.leads, needed: t.bandMinLeads, message: `${b.label}: looks weaker, but only ${b.leads} leads (default needs ${t.bandMinLeads}). No recommendation yet.` });
      continue;
    }
    if (restStat.leads < t.bandMinLeads) continue;
    // Reduce ads: even the optimistic end of this band's funded rate is below everyone else's rate.
    if (b.fundedRateHigh !== null && restStat.fundedRate !== null && b.fundedRateHigh < restStat.fundedRate) {
      recommendations.push({ kind: "reduce_ads_in_band", band: b.key, headline: `Consider pausing or reducing ads ${b.label}`, evidence: [`${b.leads} leads arrived ${b.label}; ${pct(b.fundedRate ?? 0, 1)} were funded (at most ${pct(b.fundedRateHigh, 1)} with 90% confidence)`, `Leads at other times: ${pct(restStat.fundedRate, 1)} funded across ${restStat.leads} leads`] });
    }
    // Staff the band: slower or less often contacted in time than the rest, with enough leads to say so.
    const slow = b.medianContactMinutes !== null && restStat.medianContactMinutes !== null && b.medianContactMinutes > Math.max(sla, 2 * restStat.medianContactMinutes);
    const late = b.withinSlaShare !== null && restStat.withinSlaShare !== null && b.withinSlaShare < restStat.withinSlaShare - 0.2;
    if (slow || late) {
      recommendations.push({ kind: "staff_band", band: b.key, headline: `Consider staffing ${b.label}`, evidence: [`Leads arriving ${b.label}: median first contact ${b.medianContactMinutes === null ? "n/a" : Math.round(b.medianContactMinutes) + " min"}, ${pct(b.withinSlaShare ?? 0)} contacted within ${sla} min (${b.leads} leads)`, `Other times: median ${restStat.medianContactMinutes === null ? "n/a" : Math.round(restStat.medianContactMinutes) + " min"}, ${pct(restStat.withinSlaShare ?? 0)} within ${sla} min (${restStat.leads} leads)`] });
    }
  }
  return { heat: { available: !!s.hours && s.hours.length > 0, cells: [...heatMap.values()] }, hours, bands, recommendations, holds, leadsUsed: sum(bands.map((b) => b.leads)) };
}

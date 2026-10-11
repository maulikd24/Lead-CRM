import { DEFAULT_THRESHOLDS, type Thresholds } from "./thresholds";
import { ratio, sum } from "./stats";
import type { AutopilotSnapshot, LeadRecord } from "./types";

/** Best regions by what happens after the click: cost per FUNDED customer, and AUM and revenue per rupee. Pure. */

export type RegionRow = {
  kind: "city" | "state";
  name: string;
  leads: number;
  funded: number;
  spend: number | null;
  costPerFunded: number | null;
  aum: number;
  revenue: number;
  aumPerRupee: number | null;
  revenuePerRupee: number | null;
  /** Why this row is not ranked, when it is not. */
  note: string | null;
};
export type RegionReport = {
  spendAvailable: boolean;
  byCostPerFunded: RegionRow[];
  byAumPerRupee: RegionRow[];
  /** Everything, including rows too small to rank. */
  all: RegionRow[];
};

const norm = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase();

export function topRegions(s: AutopilotSnapshot, kind: "city" | "state", t: Thresholds = DEFAULT_THRESHOLDS): RegionReport {
  const minLeads = Math.ceil(t.minLeads / 2);
  const minFunded = 3;
  const keyOf = (l: LeadRecord) => (kind === "city" ? l.city : l.state);
  const groups = new Map<string, { name: string; leads: LeadRecord[] }>();
  for (const l of s.leads) {
    const raw = keyOf(l);
    if (!raw || !raw.trim()) continue;
    const k = norm(raw);
    const g = groups.get(k) ?? { name: raw.trim(), leads: [] };
    g.leads.push(l); groups.set(k, g);
  }
  const spendRows = (s.regionSpend ?? []).filter((r) => r.kind === kind);
  const spendAvailable = spendRows.length > 0;
  const spendOf = new Map<string, number>();
  for (const r of spendRows) spendOf.set(norm(r.name), (spendOf.get(norm(r.name)) ?? 0) + r.spend);

  const all: RegionRow[] = [...groups].map(([k, g]) => {
    const funded = g.leads.filter((l) => l.funded).length;
    const spend = spendAvailable ? (spendOf.get(k) ?? null) : null;
    const aum = sum(g.leads.map((l) => l.aum));
    const revenue = sum(g.leads.map((l) => l.revenue));
    let note: string | null = null;
    if (!spendAvailable) note = "Spend by region is not reported by the platforms yet";
    else if (spend === null || spend <= 0) note = "No spend recorded for this region";
    else if (g.leads.length < minLeads) note = `Only ${g.leads.length} leads (default needs ${minLeads})`;
    else if (funded < minFunded) note = `Only ${funded} funded customers (default needs ${minFunded})`;
    return { kind, name: g.name, leads: g.leads.length, funded, spend, costPerFunded: note || spend === null ? null : ratio(spend, funded), aum, revenue, aumPerRupee: note || spend === null ? null : ratio(aum, spend), revenuePerRupee: note || spend === null ? null : ratio(revenue, spend), note };
  });
  const byCostPerFunded = all.filter((r) => r.costPerFunded !== null).sort((a, b) => (a.costPerFunded as number) - (b.costPerFunded as number));
  const byAumPerRupee = all.filter((r) => r.aumPerRupee !== null).sort((a, b) => (b.aumPerRupee as number) - (a.aumPerRupee as number));
  return { spendAvailable, byCostPerFunded, byAumPerRupee, all: all.sort((a, b) => b.leads - a.leads) };
}

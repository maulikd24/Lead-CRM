import { addDays, dayDiff } from "@/lib/marketing/dates";

import type { Confidence, Group } from "./model";

/**
 * Campaign impact: what each campaign and creative cost and what it brought in, counted from the customers' FIRST touch.
 * Pure. Cost per lead, cost per funded customer and return use only the leads and revenue of campaigns that have spend, so a
 * partner, referral or organic customer never dilutes a campaign's cost. A figure that cannot be known (no spend synced for
 * the campaign, another currency) is `null` and shown as "–": nothing is estimated.
 */

export type ContactClass = "in_sla" | "late" | "pending" | "missed";

export function classifyContact(input: { createdAt: Date; contactedAt: Date | null; slaMinutes: number; now: Date }): ContactClass {
  const sla = input.slaMinutes * 60_000;
  if (input.contactedAt) return input.contactedAt.getTime() - input.createdAt.getTime() <= sla ? "in_sla" : "late";
  return input.now.getTime() < input.createdAt.getTime() + sla ? "pending" : "missed";
}

export type ImpactClient = {
  clientId: string;
  name: string;
  rmId: string | null;
  rmName: string | null;
  stage: string;
  createdAt: Date;
  /** "YYYY-MM" of the lead's creation. */
  leadMonth: string;
  group: Group;
  creative: string | null;
  confidence: Confidence | null;
  contact: ContactClass;
  firstContactMinutes: number | null;
  kycApproved: boolean;
  funded: boolean;
  /** Net brokerage and advisory revenue to date, INR. */
  revenue: number;
  revenueByMonth: Record<string, number>;
};

export type SpendInput = { key: string; label: string; channel: "meta" | "google"; spend: number; currency: string; creatives: { name: string; spend: number }[] };

export type CreativeRow = { name: string; spend: number | null; leads: number; funded: number; revenue: number; cpl: number | null };
export type CohortRow = { month: string; leads: number; funded: number; revenue: number };

export type ImpactRow = {
  key: string;
  label: string;
  kind: Group["kind"];
  channel: "meta" | "google" | null;
  spend: number | null;
  spendKnown: boolean;
  leads: number;
  contactedInSla: number;
  contactedInSlaRate: number | null;
  /** Reached, but after the SLA. */
  late: number;
  /** Never reached, and the SLA window has passed. */
  missed: number;
  kyc: number;
  kycRate: number | null;
  funded: number;
  fundedRate: number | null;
  revenue: number;
  cpl: number | null;
  costPerFunded: number | null;
  roas: number | null;
  /** Months after the first lead month in which cumulative revenue first covered the spend; null if it has not yet. */
  paybackMonths: number | null;
  /** Share of the spend recovered by revenue so far. */
  recoveredPct: number | null;
  creatives: CreativeRow[];
  cohorts: CohortRow[];
  confidence: { high: number; medium: number; low: number };
};

export type ImpactTotals = { leads: number; spend: number | null; cpl: number | null; kyc: number; funded: number; revenue: number; roas: number | null; contactedInSlaRate: number | null; late: number; missed: number };

export type ImpactReport = { rows: ImpactRow[]; totals: ImpactTotals; unattributedShare: number | null; notes: string[]; currency: string };

const div = (a: number, b: number): number | null => (b > 0 && Number.isFinite(a / b) ? a / b : null);
const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));
const channelOf = (key: string): "meta" | "google" | null => (key.startsWith("meta:") ? "meta" : key.startsWith("google:") ? "google" : null);

type Acc = { clients: ImpactClient[] };

function rowFor(key: string, label: string, kind: Group["kind"], clients: ImpactClient[], spendInput: SpendInput | null, currency: string, notes: string[]): ImpactRow {
  const sameCurrency = spendInput && spendInput.currency === currency;
  if (spendInput && !sameCurrency) notes.push(`${spendInput.currency} spend for "${label}" was left out, because amounts in different currencies cannot be added.`);
  const spend = kind === "campaign" && spendInput && sameCurrency ? spendInput.spend : null;

  const leads = clients.length;
  const inSla = clients.filter((c) => c.contact === "in_sla").length;
  const resolved = clients.filter((c) => c.contact !== "pending").length;
  const kyc = clients.filter((c) => c.kycApproved).length;
  const funded = clients.filter((c) => c.funded).length;
  const revenue = clients.reduce((a, c) => a + c.revenue, 0);

  const byMonth = new Map<string, number>();
  for (const c of clients) for (const [m, v] of Object.entries(c.revenueByMonth)) byMonth.set(m, (byMonth.get(m) ?? 0) + v);
  const firstLead = clients.map((c) => c.leadMonth).sort()[0] ?? null;
  let paybackMonths: number | null = null;
  if (spend !== null && spend > 0 && firstLead) {
    let cumulative = 0;
    for (const m of [...byMonth.keys()].sort()) {
      cumulative += byMonth.get(m) ?? 0;
      if (cumulative >= spend) {
        paybackMonths = Math.max(0, monthIndex(m) - monthIndex(firstLead));
        break;
      }
    }
  }

  const creativeNames = new Set<string>([...clients.flatMap((c) => (c.creative ? [c.creative] : [])), ...(spendInput?.creatives.map((c) => c.name) ?? [])]);
  const creatives: CreativeRow[] = [...creativeNames]
    .map((name) => {
      const mine = clients.filter((c) => c.creative === name);
      const cs = sameCurrency ? spendInput?.creatives.find((c) => c.name === name)?.spend ?? null : null;
      return { name, spend: cs, leads: mine.length, funded: mine.filter((c) => c.funded).length, revenue: mine.reduce((a, c) => a + c.revenue, 0), cpl: cs !== null ? div(cs, mine.length) : null };
    })
    .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name));

  const cohortMap = new Map<string, CohortRow>();
  for (const c of clients) {
    const r = cohortMap.get(c.leadMonth) ?? { month: c.leadMonth, leads: 0, funded: 0, revenue: 0 };
    r.leads++;
    if (c.funded) r.funded++;
    r.revenue += c.revenue;
    cohortMap.set(c.leadMonth, r);
  }

  return {
    key, label, kind, channel: channelOf(key), spend, spendKnown: spend !== null, leads,
    contactedInSla: inSla, contactedInSlaRate: div(inSla, resolved),
    late: clients.filter((c) => c.contact === "late").length, missed: clients.filter((c) => c.contact === "missed").length,
    kyc, kycRate: div(kyc, leads), funded, fundedRate: div(funded, leads), revenue,
    cpl: spend !== null ? div(spend, leads) : null,
    costPerFunded: spend !== null ? div(spend, funded) : null,
    roas: spend !== null && revenue > 0 ? div(revenue, spend) : null,
    paybackMonths,
    recoveredPct: spend !== null && spend > 0 ? revenue / spend : null,
    creatives,
    cohorts: [...cohortMap.values()].sort((a, b) => a.month.localeCompare(b.month)),
    confidence: { high: clients.filter((c) => c.confidence === "high").length, medium: clients.filter((c) => c.confidence === "medium").length, low: clients.filter((c) => c.confidence === "low").length },
  };
}

export function buildImpact(input: { clients: ImpactClient[]; spend: SpendInput[]; slaMinutes: number; currency: string }): ImpactReport {
  const notes: string[] = [];
  const groups = new Map<string, { group: Group; acc: Acc }>();
  for (const c of input.clients) {
    const g = groups.get(c.group.key) ?? { group: c.group, acc: { clients: [] } };
    g.acc.clients.push(c);
    groups.set(c.group.key, g);
  }
  // A campaign with spend but no leads still gets a row.
  for (const s of input.spend) if (!groups.has(s.key)) groups.set(s.key, { group: { key: s.key, label: s.label, kind: "campaign" }, acc: { clients: [] } });

  const rows = [...groups.values()].map(({ group, acc }) => rowFor(group.key, group.label, group.kind, acc.clients, input.spend.find((s) => s.key === group.key) ?? null, input.currency, notes));
  rows.sort((a, b) => (b.spend ?? -1) - (a.spend ?? -1) || b.leads - a.leads || a.label.localeCompare(b.label));

  const spent = rows.filter((r) => r.spend !== null);
  const spend = spent.length ? spent.reduce((a, r) => a + (r.spend ?? 0), 0) : null;
  const spentLeads = spent.reduce((a, r) => a + r.leads, 0);
  const spentRevenue = spent.reduce((a, r) => a + r.revenue, 0);
  const leads = rows.reduce((a, r) => a + r.leads, 0);
  const inSla = rows.reduce((a, r) => a + r.contactedInSla, 0);
  const resolved = input.clients.filter((c) => c.contact !== "pending").length;
  const unattributed = rows.filter((r) => r.kind === "unattributed").reduce((a, r) => a + r.leads, 0);

  return {
    rows,
    totals: {
      leads, spend, cpl: spend !== null ? div(spend, spentLeads) : null,
      kyc: rows.reduce((a, r) => a + r.kyc, 0), funded: rows.reduce((a, r) => a + r.funded, 0), revenue: rows.reduce((a, r) => a + r.revenue, 0),
      roas: spend !== null && spentRevenue > 0 ? div(spentRevenue, spend) : null,
      contactedInSlaRate: div(inSla, resolved),
      late: rows.reduce((a, r) => a + r.late, 0), missed: rows.reduce((a, r) => a + r.missed, 0),
    },
    unattributedShare: div(unattributed, leads),
    notes: [...new Set(notes)],
    currency: input.currency,
  };
}

export type Delta = { value: number | null; prev: number | null; change: number | null };
const delta = (value: number | null, prev: number | null): Delta => ({ value, prev, change: value !== null && prev !== null && prev > 0 ? (value - prev) / prev : null });

export type ImpactComparison = {
  totals: { leads: Delta; spend: Delta; cpl: Delta; funded: Delta; revenue: Delta; roas: Delta };
  rows: Record<string, { leads: Delta; cpl: Delta; funded: Delta; revenue: Delta; roas: Delta }>;
};

export function compareImpact(cur: ImpactReport, prev: ImpactReport): ImpactComparison {
  const t = (k: "leads" | "spend" | "cpl" | "funded" | "revenue" | "roas") => delta(cur.totals[k], prev.totals[k]);
  const rows: ImpactComparison["rows"] = {};
  for (const r of cur.rows) {
    const p = prev.rows.find((x) => x.key === r.key);
    rows[r.key] = { leads: delta(r.leads, p?.leads ?? 0), cpl: delta(r.cpl, p?.cpl ?? null), funded: delta(r.funded, p?.funded ?? 0), revenue: delta(r.revenue, p?.revenue ?? 0), roas: delta(r.roas, p?.roas ?? null) };
  }
  return { totals: { leads: t("leads"), spend: t("spend"), cpl: t("cpl"), funded: t("funded"), revenue: t("revenue"), roas: t("roas") }, rows };
}

export const STALE_AFTER_HOURS = 36;

export type SpendFreshness = { lastSuccessAt: Date | null; ageLabel: string | null; stale: boolean; partial: boolean; coveredDays: number; expectedDays: number; messages: string[] };

function ago(from: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} days ago`;
}

export function spendFreshness(input: { now: Date; today: string; range: { from: string; to: string }; lastSuccessAt: Date | null; daysWithData: Set<string>; historyStart: string | null }): SpendFreshness {
  const messages: string[] = [];
  const from = input.historyStart && input.historyStart > input.range.from ? input.historyStart : input.range.from;
  const to = input.range.to < input.today ? input.range.to : input.today;
  const expectedDays = Math.max(0, dayDiff(from, to) + 1);
  let covered = 0;
  for (let i = 0; i < expectedDays; i++) if (input.daysWithData.has(addDays(from, i))) covered++;
  const ageLabel = input.lastSuccessAt ? ago(input.lastSuccessAt, input.now) : null;
  const ageMs = input.lastSuccessAt ? input.now.getTime() - input.lastSuccessAt.getTime() : Infinity;
  const stale = ageMs > STALE_AFTER_HOURS * 3_600_000;
  const partial = expectedDays > 0 && covered < expectedDays;

  if (!input.lastSuccessAt && covered === 0) messages.push("No spend data has been synced yet, so cost and return figures are not shown.");
  else if (stale && ageLabel) messages.push(`Spend was last updated ${ageLabel}, so the most recent days may be missing and costs may look lower than they are.`);
  if (partial && covered > 0) messages.push(`Spend is available for ${covered} of ${expectedDays} days in this range; cost figures cover only those days.`);
  if (input.historyStart && input.historyStart > input.range.from) messages.push(`Spend history starts on ${input.historyStart}; earlier days are not counted.`);
  return { lastSuccessAt: input.lastSuccessAt, ageLabel, stale, partial, coveredDays: covered, expectedDays, messages };
}

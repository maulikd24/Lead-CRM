import { OUTCOMES } from "@/lib/intelligence/constants";
import { median } from "./agent-quality";

/**
 * Pure aggregations for "what do customers actually respond to". Every function takes plain rows (loaded and scoped by
 * queries.ts) so it can be tested with fixtures. Output is aggregate only: no customer names or ids ever appear in a result.
 */

const H = 3_600_000;
const D = 24 * H;
const rate = (num: number, den: number) => (den > 0 ? num / den : null);

export type OutcomeValue = (typeof OUTCOMES)[number]["value"];
export const OUTCOME_VALUES = OUTCOMES.map((o) => o.value) as OutcomeValue[];

export type OutcomeRow = {
  clientId: string;
  outcome: OutcomeValue;
  channel: string;
  actorType: string;
  rmId: string | null;
  rmName: string | null;
  assetClass: string | null;
  programme: string | null;
  language: string | null;
  createdAt: Date;
  /** An approved agent draft was sent to this customer shortly before the outcome. */
  aiDraftSent: boolean;
};

// ---- Outcome mix -----------------------------------------------------------------------------------------------

export type OutcomeMixGroup = {
  key: string;
  total: number;
  counts: Record<OutcomeValue, number>;
  /** Interested + Converted, as a share of the group. */
  positiveRate: number | null;
  /** Not interested + Not relevant, as a share of the group. */
  declineRate: number | null;
};

export function outcomeMix(rows: OutcomeRow[], keyFn: (r: OutcomeRow) => string | null): OutcomeMixGroup[] {
  const groups = new Map<string, OutcomeMixGroup>();
  for (const r of rows) {
    const key = keyFn(r) ?? "Unspecified";
    let g = groups.get(key);
    if (!g) {
      g = { key, total: 0, counts: Object.fromEntries(OUTCOME_VALUES.map((v) => [v, 0])) as Record<OutcomeValue, number>, positiveRate: null, declineRate: null };
      groups.set(key, g);
    }
    g.total++;
    g.counts[r.outcome]++;
  }
  for (const g of groups.values()) {
    g.positiveRate = rate(g.counts.INTERESTED + g.counts.CONVERTED, g.total);
    g.declineRate = rate(g.counts.NOT_INTERESTED + g.counts.NOT_RELEVANT, g.total);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

export const byProgramme = (r: OutcomeRow) => r.programme;
export const byAssetClass = (r: OutcomeRow) => r.assetClass;
export const byLanguage = (r: OutcomeRow) => r.language;
export const byRm = (r: OutcomeRow) => r.rmName;

const CHANNEL_LABEL: Record<string, string> = { CALL: "Call", WHATSAPP: "WhatsApp (RM)", MEETING: "Meeting", EMAIL: "Email", AI_BOT: "AI agent", OTHER: "Other" };

/** The channel view: the AI agent itself, an RM acting after an approved AI draft, or the RM's own channel. */
export function channelGroup(r: OutcomeRow): string {
  if (r.actorType === "AI_AGENT") return "AI agent";
  if (r.aiDraftSent) return "RM after AI draft";
  return CHANNEL_LABEL[r.channel] ?? "Other";
}
export const byChannel = channelGroup;

/** Marks each outcome that came within `windowDays` after an approved AI draft was sent to the same customer. */
export function attachDraftContext(outcomes: OutcomeRow[], sentDrafts: { clientId: string; sentAt: Date }[], windowDays = 7): OutcomeRow[] {
  const byClient = new Map<string, number[]>();
  for (const d of sentDrafts) byClient.set(d.clientId, [...(byClient.get(d.clientId) ?? []), d.sentAt.getTime()]);
  return outcomes.map((o) => {
    const t = o.createdAt.getTime();
    const hit = (byClient.get(o.clientId) ?? []).some((s) => t >= s && t - s <= windowDays * D);
    return { ...o, aiDraftSent: hit };
  });
}

// ---- Time to respond -------------------------------------------------------------------------------------------

export type OutboundRow = { id: string; clientId: string; sentAt: Date; group: string; language: string | null };
export type InboundRow = { clientId: string; at: Date };
export type ResponseGroup = { key: string; sent: number; replied: number; replyRate: number | null; medianHours: number | null };

const BUCKETS: { label: string; maxHours: number }[] = [
  { label: "Under 1 hour", maxHours: 1 },
  { label: "1 to 4 hours", maxHours: 4 },
  { label: "4 to 24 hours", maxHours: 24 },
  { label: "1 to 3 days", maxHours: 72 },
  { label: "Over 3 days", maxHours: Infinity },
];

export function responseTimes(outbound: OutboundRow[], inbound: InboundRow[], opts: { windowHours: number; now: Date }) {
  const inboundBy = new Map<string, number[]>();
  for (const i of inbound) inboundBy.set(i.clientId, [...(inboundBy.get(i.clientId) ?? []), i.at.getTime()]);
  for (const list of inboundBy.values()) list.sort((a, b) => a - b);

  const group = new Map<string, { sent: number; delays: number[] }>();
  const lang = new Map<string, { sent: number; delays: number[] }>();
  const bucketCounts = BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  let immature = 0;
  let sent = 0;
  const allDelays: number[] = [];

  const add = (m: Map<string, { sent: number; delays: number[] }>, key: string, delay: number | null) => {
    const g = m.get(key) ?? { sent: 0, delays: [] };
    g.sent++;
    if (delay !== null) g.delays.push(delay);
    m.set(key, g);
  };

  for (const o of outbound) {
    const t = o.sentAt.getTime();
    if (t + opts.windowHours * H > opts.now.getTime()) {
      immature++;
      continue;
    }
    const first = (inboundBy.get(o.clientId) ?? []).find((x) => x > t);
    const delay = first !== undefined && first - t <= opts.windowHours * H ? (first - t) / H : null;
    add(group, o.group, delay);
    add(lang, o.language ?? "Unspecified", delay);
    sent++;
    if (delay !== null) {
      allDelays.push(delay);
      bucketCounts[BUCKETS.findIndex((b) => delay < b.maxHours)].count++;
    }
  }

  const finish = (m: Map<string, { sent: number; delays: number[] }>): ResponseGroup[] =>
    [...m.entries()]
      .map(([key, g]) => ({ key, sent: g.sent, replied: g.delays.length, replyRate: rate(g.delays.length, g.sent), medianHours: median(g.delays) }))
      .sort((a, b) => b.sent - a.sent || a.key.localeCompare(b.key));

  return {
    byGroup: finish(group),
    byLanguage: finish(lang),
    buckets: bucketCounts,
    immature,
    overall: { sent, replied: allDelays.length, replyRate: rate(allDelays.length, sent), medianHours: median(allDelays) },
  };
}

// ---- Conversion after an outcome or a draft -------------------------------------------------------------------

export type Milestones = { kycAt: Date | null; fundedAt: Date | null };
export type ConversionEvent = { clientId: string; at: Date; group: string };
export type ConversionGroup = { key: string; n: number; kyc: number; funded: number; kycRate: number | null; fundedRate: number | null };

/**
 * Of the events that are at least `days` old (younger ones have not had a fair chance yet), how many were followed by
 * KYC approval / first funding within `days`?
 */
export function conversionWithin(events: ConversionEvent[], milestones: Map<string, Milestones>, days: number, now: Date) {
  const groups = new Map<string, { n: number; kyc: number; funded: number }>();
  let immature = 0;
  const within = (m: Date | null, from: number) => !!m && m.getTime() >= from && m.getTime() <= from + days * D;
  for (const e of events) {
    const t = e.at.getTime();
    if (t + days * D > now.getTime()) {
      immature++;
      continue;
    }
    const g = groups.get(e.group) ?? { n: 0, kyc: 0, funded: 0 };
    const m = milestones.get(e.clientId);
    g.n++;
    if (within(m?.kycAt ?? null, t)) g.kyc++;
    if (within(m?.fundedAt ?? null, t)) g.funded++;
    groups.set(e.group, g);
  }
  return {
    windowDays: days,
    immature,
    groups: [...groups.entries()]
      .map(([key, g]): ConversionGroup => ({ key, ...g, kycRate: rate(g.kyc, g.n), fundedRate: rate(g.funded, g.n) }))
      .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key)),
  };
}

// ---- Objections ------------------------------------------------------------------------------------------------

/** Ordered: the first matching theme wins. Free text is reduced to a theme label, so no customer wording is displayed. */
const THEMES: { theme: string; re: RegExp }[] = [
  { theme: "Lock-in / liquidity", re: /lock[\s-]?(?:in|ed)|liquidity|exit\s+load|withdraw|redeem|tenure|illiquid/i },
  { theme: "Fees and costs", re: /\bfees?\b|charges?|\bcosts?\b|expens|brokerage|commission|carry\b/i },
  { theme: "Ticket size", re: /minimum|ticket|too\s+(?:large|big)|\blakh|\bcrore|\bcr\b|commitment\s+size/i },
  { theme: "Trust / safety", re: /trust|sebi|regulat|scam|fraud|genuine|credib|safety|reputation|online\s+platform|new\s+company/i },
  { theme: "Returns / performance", re: /return|perform|yield|\bfd\b|lower\s+than|cagr|xirr|benchmark/i },
  { theme: "Risk / volatility", re: /risk|volatil|\bloss|crash|drawdown|market\s+(?:fall|down)|uncertain/i },
  { theme: "Already invested elsewhere", re: /already|another\s+(?:broker|platform|advisor|bank)|elsewhere|existing\s+(?:advisor|broker|relationship)|my\s+(?:own\s+)?(?:advisor|banker|broker)/i },
  { theme: "Process / paperwork", re: /process|paperwork|\bkyc\b|document|complex|confus|understand|tedious|hassle/i },
  { theme: "Timing", re: /later|next\s+(?:month|week|year|quarter)|not\s+now|busy|call\s+(?:me\s+)?back|wait|bad\s+time|after\s+\w+/i },
];

export function classifyObjection(text: string): string {
  return THEMES.find((t) => t.re.test(text ?? ""))?.theme ?? "Other";
}

export type ObjectionTrend = "up" | "down" | "flat" | "new";
export type ObjectionTheme = { theme: string; count: number; prevCount: number; trend: ObjectionTrend };
export type ObjectionRow = { assetClass: string; total: number; themes: ObjectionTheme[] };
type ObjectionInput = { assetClass: string | null; text: string };

export function objectionLeaderboard(current: ObjectionInput[], previous: ObjectionInput[]): { rows: ObjectionRow[]; themes: string[] } {
  const tally = (list: ObjectionInput[]) => {
    const m = new Map<string, Map<string, number>>();
    for (const o of list) {
      const ac = o.assetClass ?? "Unspecified";
      const th = classifyObjection(o.text);
      const inner = m.get(ac) ?? new Map<string, number>();
      inner.set(th, (inner.get(th) ?? 0) + 1);
      m.set(ac, inner);
    }
    return m;
  };
  const cur = tally(current);
  const prev = tally(previous);
  const themeTotals = new Map<string, number>();
  const rows: ObjectionRow[] = [...cur.entries()].map(([assetClass, inner]) => {
    const themes = [...inner.entries()]
      .map(([theme, count]): ObjectionTheme => {
        const prevCount = prev.get(assetClass)?.get(theme) ?? 0;
        themeTotals.set(theme, (themeTotals.get(theme) ?? 0) + count);
        return { theme, count, prevCount, trend: prevCount === 0 ? "new" : count > prevCount ? "up" : count < prevCount ? "down" : "flat" };
      })
      .sort((a, b) => b.count - a.count || a.theme.localeCompare(b.theme));
    return { assetClass, total: themes.reduce((s, t) => s + t.count, 0), themes };
  });
  rows.sort((a, b) => b.total - a.total || a.assetClass.localeCompare(b.assetClass));
  return { rows, themes: [...themeTotals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t) };
}

// ---- Journey funnel --------------------------------------------------------------------------------------------

export type StageDef = { id: string; name: string; sequence: number };
export type FunnelRow = { stageId: string; name: string; sequence: number; reached: number; advanced: number; stillHere: number; conversion: number | null; medianHoursInStage: number | null };

export function stageFunnel(
  stages: StageDef[],
  clients: { id: string; createdAt: Date; currentStageId: string }[],
  history: { clientId: string; fromStageId: string | null; toStageId: string; changedAt: Date }[],
): FunnelRow[] {
  const ordered = [...stages].sort((a, b) => a.sequence - b.sequence);
  const seq = new Map(ordered.map((s) => [s.id, s.sequence]));
  const histBy = new Map<string, typeof history>();
  for (const h of history) histBy.set(h.clientId, [...(histBy.get(h.clientId) ?? []), h]);

  const reached = new Map<string, number>();
  const advanced = new Map<string, number>();
  const stillHere = new Map<string, number>();
  const durations = new Map<string, number[]>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  for (const c of clients) {
    const hs = (histBy.get(c.id) ?? []).sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());
    const stays: { stageId: string; start: number; end: number | null }[] = [];
    if (hs.length === 0) stays.push({ stageId: c.currentStageId, start: c.createdAt.getTime(), end: null });
    else {
      if (hs[0].fromStageId) stays.push({ stageId: hs[0].fromStageId, start: c.createdAt.getTime(), end: hs[0].changedAt.getTime() });
      hs.forEach((h, i) => stays.push({ stageId: h.toStageId, start: h.changedAt.getTime(), end: hs[i + 1]?.changedAt.getTime() ?? null }));
    }
    const visited = new Set(stays.map((s) => s.stageId));
    const maxSeq = Math.max(...[...visited].map((id) => seq.get(id) ?? 0));
    for (const id of visited) {
      if (!seq.has(id)) continue;
      bump(reached, id);
      if ((seq.get(id) ?? 0) < maxSeq) bump(advanced, id);
    }
    if (seq.has(c.currentStageId)) bump(stillHere, c.currentStageId);
    for (const s of stays) if (s.end !== null && seq.has(s.stageId)) durations.set(s.stageId, [...(durations.get(s.stageId) ?? []), (s.end - s.start) / H]);
  }

  return ordered.map((s, i) => ({
    stageId: s.id,
    name: s.name,
    sequence: s.sequence,
    reached: reached.get(s.id) ?? 0,
    advanced: advanced.get(s.id) ?? 0,
    stillHere: stillHere.get(s.id) ?? 0,
    conversion: i === ordered.length - 1 ? null : rate(advanced.get(s.id) ?? 0, reached.get(s.id) ?? 0),
    medianHoursInStage: median(durations.get(s.id) ?? []),
  }));
}

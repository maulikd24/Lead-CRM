/**
 * Creative fatigue detection. Pure: no database, no clock.
 *
 * An ad is "tired" when the same people have seen it too often and it stops working. Three signals, each judged
 * on a recent window against the window just before it, and each only when there is enough volume to mean anything:
 *   - frequency   average daily impressions per person reached in the recent window (needs reach in the data)
 *   - ctr_decay   click-through rate down by at least a set percentage
 *   - cpl_drift   cost per lead up by at least a set percentage
 * One signal is "watch", two or more is "fatigued". Too little data is "insufficient": we say so, we do not guess.
 *
 * Every threshold is a default, labelled as such on screen, and can be changed in Settings.
 */

export type DailyPoint = { date: string; impressions: number; clicks: number; spend: number; leads: number; reach?: number | null };

export type FatigueThresholds = {
  /** Average daily frequency at or above this is a signal. */
  frequency: number;
  /** Click-through rate drop, in percent of the earlier window, at or above this is a signal. */
  ctrDecayPct: number;
  /** Cost per lead rise, in percent of the earlier window, at or above this is a signal. */
  cplDriftPct: number;
  /** Days in each comparison window. */
  windowDays: number;
  /** Fewest days of delivery before any judgement. */
  minDays: number;
  /** Fewest impressions in each window before click-through is judged. */
  minImpressions: number;
  /** Fewest leads in each window before cost per lead is judged. */
  minLeads: number;
};

export const DEFAULT_FATIGUE_THRESHOLDS: FatigueThresholds = { frequency: 3.5, ctrDecayPct: 25, cplDriftPct: 30, windowDays: 5, minDays: 10, minImpressions: 2000, minLeads: 3 };

export type SignalKind = "frequency" | "ctr_decay" | "cpl_drift";
export type FatigueSignal = { kind: SignalKind; message: string; /** The size of the change (percent) or the frequency. */ changePct: number };
export type CheckState = "ok" | "signal" | "insufficient";
export type FatigueStatus = "ok" | "watch" | "fatigued" | "insufficient";

export type FatigueResult = {
  status: FatigueStatus;
  signals: FatigueSignal[];
  checks: { frequency: CheckState | "not_reported"; ctr: CheckState; cpl: CheckState };
  frequency: { state: "not_reported" } | { state: "reported"; average: number };
  note: string | null;
};

const sum = (rows: DailyPoint[], pick: (r: DailyPoint) => number) => rows.reduce((a, r) => a + pick(r), 0);
const round1 = (n: number) => Math.round(n * 10) / 10;

export function detectFatigue(points: DailyPoint[], thresholds: FatigueThresholds = DEFAULT_FATIGUE_THRESHOLDS): FatigueResult {
  const t = thresholds;
  const rows = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const days = new Set(rows.map((r) => r.date)).size;
  if (days < t.minDays) {
    return { status: "insufficient", signals: [], checks: { frequency: "insufficient", ctr: "insufficient", cpl: "insufficient" }, frequency: { state: "not_reported" }, note: `Needs at least ${t.minDays} days of delivery to judge fatigue; this ad has ${days}.` };
  }

  const recent = rows.slice(-t.windowDays);
  const before = rows.slice(-t.windowDays * 2, -t.windowDays);
  const signals: FatigueSignal[] = [];
  const checks: FatigueResult["checks"] = { frequency: "not_reported", ctr: "insufficient", cpl: "insufficient" };

  // Frequency: only where the data carries reach.
  const withReach = recent.filter((r) => (r.reach ?? 0) > 0);
  let frequency: FatigueResult["frequency"] = { state: "not_reported" };
  if (withReach.length >= Math.ceil(recent.length / 2)) {
    const average = sum(withReach, (r) => r.impressions / (r.reach as number)) / withReach.length;
    frequency = { state: "reported", average: round1(average) };
    if (average >= t.frequency) {
      checks.frequency = "signal";
      signals.push({ kind: "frequency", changePct: round1(average), message: `Each person reached saw this ad about ${round1(average)} times a day on average (default threshold ${t.frequency}).` });
    } else checks.frequency = "ok";
  }

  const impR = sum(recent, (r) => r.impressions);
  const impB = sum(before, (r) => r.impressions);
  if (before.length > 0 && impR >= t.minImpressions && impB >= t.minImpressions) {
    const ctrR = sum(recent, (r) => r.clicks) / impR;
    const ctrB = sum(before, (r) => r.clicks) / impB;
    const drop = ctrB > 0 ? ((ctrB - ctrR) / ctrB) * 100 : 0;
    if (drop >= t.ctrDecayPct) {
      checks.ctr = "signal";
      signals.push({ kind: "ctr_decay", changePct: round1(drop), message: `Click-through rate fell ${round1(drop)}% against the ${before.length} days before (${round1(ctrB * 100)}% to ${round1(ctrR * 100)}%).` });
    } else checks.ctr = "ok";
  }

  const leadsR = sum(recent, (r) => r.leads);
  const leadsB = sum(before, (r) => r.leads);
  if (before.length > 0 && leadsR >= t.minLeads && leadsB >= t.minLeads) {
    const cplR = sum(recent, (r) => r.spend) / leadsR;
    const cplB = sum(before, (r) => r.spend) / leadsB;
    const rise = cplB > 0 ? ((cplR - cplB) / cplB) * 100 : 0;
    if (rise >= t.cplDriftPct) {
      checks.cpl = "signal";
      signals.push({ kind: "cpl_drift", changePct: round1(rise), message: `Cost per lead rose ${round1(rise)}% against the ${before.length} days before.` });
    } else checks.cpl = "ok";
  }

  const judged = [checks.frequency, checks.ctr, checks.cpl].some((c) => c === "ok" || c === "signal");
  const status: FatigueStatus = signals.length >= 2 ? "fatigued" : signals.length === 1 ? "watch" : judged ? "ok" : "insufficient";
  const note = status === "insufficient" ? "Delivery is too thin in the recent window to judge click-through or cost per lead." : null;
  return { status, signals, checks, frequency, note };
}

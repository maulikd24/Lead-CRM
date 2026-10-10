/**
 * Support SLA clock maths. Pure and dependency free.
 *
 * Business hours (a documented constant, tune here): Monday to Friday, 09:30 to 18:30 India Standard Time
 * (UTC+05:30, no daylight saving). There is no public-holiday calendar: a holiday counts as a working day.
 * "One working day" is therefore 9 business hours (540 minutes).
 */
export const BUSINESS_HOURS = {
  offsetMinutes: 330,
  startMinute: 9 * 60 + 30,
  endMinute: 18 * 60 + 30,
  /** 0 = Sunday ... 6 = Saturday. */
  workdays: [1, 2, 3, 4, 5],
} as const;

export type TicketPriority = "urgent" | "high" | "medium" | "low";
export type SlaKind = "task" | "firstResponse" | "resolution";

const WORKING_DAY = BUSINESS_HOURS.endMinute - BUSINESS_HOURS.startMinute; // 540
const MIN = 60_000;

/** Wall clock: counted round the clock (urgent only). Business: counted only inside business hours. */
type Rule = { clock: "wall" | "business"; minutes: number };

export const SLA_POLICY: Record<TicketPriority, Record<SlaKind, Rule>> = {
  urgent: { task: { clock: "wall", minutes: 120 }, firstResponse: { clock: "wall", minutes: 60 }, resolution: { clock: "wall", minutes: 240 } },
  high: { task: { clock: "business", minutes: WORKING_DAY }, firstResponse: { clock: "business", minutes: 240 }, resolution: { clock: "business", minutes: WORKING_DAY } },
  medium: { task: { clock: "business", minutes: 2 * WORKING_DAY }, firstResponse: { clock: "business", minutes: WORKING_DAY }, resolution: { clock: "business", minutes: 3 * WORKING_DAY } },
  low: { task: { clock: "business", minutes: 3 * WORKING_DAY }, firstResponse: { clock: "business", minutes: 2 * WORKING_DAY }, resolution: { clock: "business", minutes: 5 * WORKING_DAY } },
};

// Work in "IST wall time": shift the instant so UTC getters read as IST fields.
const toLocal = (d: Date) => d.getTime() + BUSINESS_HOURS.offsetMinutes * MIN;
const fromLocal = (ms: number) => new Date(ms - BUSINESS_HOURS.offsetMinutes * MIN);

/** Adds business minutes, skipping nights and weekends. Out-of-hours starts count from the next opening. */
export function addBusinessMinutes(from: Date, minutes: number): Date {
  let local = toLocal(from);
  let remaining = Math.max(0, Math.round(minutes));
  const { startMinute, endMinute, workdays } = BUSINESS_HOURS;
  const workday = (ms: number) => (workdays as readonly number[]).includes(new Date(ms).getUTCDay());
  const dayStart = (ms: number) => ms - (((ms % 86_400_000) + 86_400_000) % 86_400_000);

  for (let guard = 0; guard < 4000; guard++) {
    const midnight = dayStart(local);
    const open = midnight + startMinute * MIN;
    const close = midnight + endMinute * MIN;
    if (!workday(local) || local >= close) {
      local = dayStart(midnight + 86_400_000) + startMinute * MIN;
      continue;
    }
    if (local < open) local = open;
    const room = Math.floor((close - local) / MIN);
    if (remaining <= room) return fromLocal(local + remaining * MIN);
    remaining -= room;
    local = close;
  }
  return fromLocal(local);
}

export function dueFor(priority: TicketPriority, kind: SlaKind, from: Date): Date {
  const rule = SLA_POLICY[priority][kind];
  return rule.clock === "wall" ? new Date(from.getTime() + rule.minutes * MIN) : addBusinessMinutes(from, rule.minutes);
}

export type SlaState = "ok" | "at_risk" | "breached" | "met";
export const AT_RISK_FROM_PCT = 75;

/** How far through its SLA window something is. `doneAt` (response sent / ticket resolved) freezes the verdict. */
export function slaProgress(start: Date, due: Date, now: Date, doneAt?: Date | null): { pct: number; state: SlaState; remainingMs: number } {
  const span = due.getTime() - start.getTime();
  const at = doneAt ?? now;
  const pct = span <= 0 ? 100 : Math.min(100, Math.max(0, Math.round(((at.getTime() - start.getTime()) / span) * 100)));
  const remainingMs = due.getTime() - now.getTime();
  if (doneAt) return { pct, state: doneAt.getTime() <= due.getTime() ? "met" : "breached", remainingMs };
  if (now.getTime() > due.getTime()) return { pct: 100, state: "breached", remainingMs };
  return { pct, state: pct >= AT_RISK_FROM_PCT ? "at_risk" : "ok", remainingMs };
}

import { CHANNEL_KEYS, type ChannelKey } from "./channels";
import type { AudienceView, PlanView } from "./types";

/** View models for the plan board, the calendar and the "what is missing" panel. Pure. */

export type BoardRow = { audience: AudienceView; cells: Record<ChannelKey, PlanView[]>; total: number };
export type Board = { columns: readonly ChannelKey[]; rows: BoardRow[]; columnTotals: Record<ChannelKey, number> };

const emptyCells = (): Record<ChannelKey, PlanView[]> => Object.fromEntries(CHANNEL_KEYS.map((k) => [k, [] as PlanView[]])) as Record<ChannelKey, PlanView[]>;

/** Rows are audiences, columns are channels. Plans of an archived audience stay visible in one last row. */
export function buildBoard(audiences: AudienceView[], plans: PlanView[]): Board {
  const active = audiences.filter((a) => !a.archived);
  const rows: BoardRow[] = active.map((audience) => ({ audience, cells: emptyCells(), total: 0 }));
  const byId = new Map(rows.map((r) => [r.audience.id, r]));
  let archived: BoardRow | null = null;
  for (const plan of plans) {
    let row = byId.get(plan.audienceId);
    if (!row) {
      archived ??= { audience: { id: "archived", key: "archived", name: "Archived audiences", archived: true }, cells: emptyCells(), total: 0 };
      row = archived;
    }
    row.cells[plan.channel].push(plan);
    row.total += 1;
  }
  if (archived) rows.push(archived);
  const columnTotals = Object.fromEntries(CHANNEL_KEYS.map((k) => [k, rows.reduce((n, r) => n + r.cells[k].length, 0)])) as Record<ChannelKey, number>;
  return { columns: CHANNEL_KEYS, rows, columnTotals };
}

export type DayEntry = { plan: PlanView; position: "single" | "start" | "middle" | "end" };

const nextDay = (ymd: string): string => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Every day of a plan's dates that falls in `month` (yyyy-mm), keyed by yyyy-mm-dd. A plan without a start date is not on the calendar. */
export function calendarDays(plans: PlanView[], month: string): Map<string, DayEntry[]> {
  const out = new Map<string, DayEntry[]>();
  for (const plan of plans) {
    if (!plan.startDate) continue;
    const end = plan.endDate && plan.endDate >= plan.startDate ? plan.endDate : plan.startDate;
    for (let day = plan.startDate, guard = 0; day <= end && guard < 400; day = nextDay(day), guard++) {
      if (!day.startsWith(month)) continue;
      const position: DayEntry["position"] = plan.startDate === end ? "single" : day === plan.startDate ? "start" : day === end ? "end" : "middle";
      out.set(day, [...(out.get(day) ?? []), { plan, position }]);
    }
  }
  return out;
}

export type MissingItem = { id: string; severity: "blocker" | "gap"; text: string; count: number; tab?: string };

const ITEM_PHRASE: Record<string, string> = {
  promise_compliant: "have a promise that fails the compliance checklist",
  destination_live: "land on a destination that is not live",
  links_tested: "have tracking links nobody has tested",
  routing_owner: "have no routing owner",
  consent_purpose: "have no consent purpose for follow-up",
  copy_approved: "have no approved copy",
  creator_registered: "have no registered creator",
};
const OPEN: readonly string[] = ["DRAFT", "NEEDS_REVIEW"];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function buildMissing(input: { audiences: AudienceView[]; plans: PlanView[]; routing: { hasFallback: boolean; audienceKeysWithRule: string[] } }): MissingItem[] {
  const items: MissingItem[] = [];
  const open = input.plans.filter((p) => OPEN.includes(p.status));

  const counts = new Map<string, number>();
  for (const p of open) for (const id of p.failing) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, count] of counts) items.push({ id, severity: "blocker", count, text: `${plural(count, "plan")} ${ITEM_PHRASE[id] ?? id}`, tab: "board" });

  const noDates = input.plans.filter((p) => !p.startDate && p.status !== "SCHEDULED");
  if (noDates.length) items.push({ id: "no_dates", severity: "gap", count: noDates.length, text: `${plural(noDates.length, "plan")} ${noDates.length === 1 ? "has" : "have"} no dates, so ${noDates.length === 1 ? "it" : "they"} cannot be scheduled`, tab: "calendar" });

  const notLive = new Map<string, { name: string; count: number }>();
  for (const p of input.plans) if (p.destinationStatus !== "LIVE") notLive.set(p.destinationId, { name: p.destinationName, count: (notLive.get(p.destinationId)?.count ?? 0) + 1 });
  for (const [id, v] of notLive) items.push({ id: `dest_not_live:${id}`, severity: "blocker", count: v.count, text: `${v.name} is not live yet and ${plural(v.count, "plan")} land${v.count === 1 ? "s" : ""} on it`, tab: "destinations" });

  if (!input.routing.hasFallback) items.push({ id: "no_fallback", severity: "gap", count: 1, text: "No fallback routing rule: leads that match nothing fall to the default assignment", tab: "routing" });
  const active = input.audiences.filter((a) => !a.archived);
  if (!input.routing.hasFallback) for (const a of active) if (!input.routing.audienceKeysWithRule.includes(a.key)) items.push({ id: `no_routing:${a.key}`, severity: "gap", count: 1, text: `No routing rule for ${a.name}`, tab: "routing" });
  const withPlan = new Set(input.plans.map((p) => p.audienceId));
  for (const a of active) if (!withPlan.has(a.id)) items.push({ id: `no_plan:${a.key}`, severity: "gap", count: 1, text: `No plan yet for ${a.name}`, tab: "board" });

  const rank = (i: MissingItem) => (i.severity === "blocker" ? 0 : 1);
  return items.sort((a, b) => rank(a) - rank(b) || b.count - a.count || (a.id < b.id ? -1 : 1));
}

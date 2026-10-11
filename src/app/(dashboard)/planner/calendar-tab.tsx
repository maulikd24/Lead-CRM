import Link from "next/link";

import { calendarDays } from "@/lib/planner/board";
import { loadPlanViews, todayYmd } from "@/lib/planner/db";
import { monthGrid } from "@/lib/marketing/zoned-time";
import { plannerHref } from "@/lib/planner/tabs";

import { Empty, PlanChip } from "./ui";

/** A month of plans by their dates. A plan with no start date is listed below the grid, not hidden. */
export async function CalendarTab({ month }: { month?: string }) {
  const today = todayYmd();
  const grid = monthGrid(month ?? "", today);
  const plans = await loadPlanViews();
  const days = calendarDays(plans, grid.month);
  const undated = plans.filter((p) => !p.startDate);
  const dayList = [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  return (
    <div className="grid gap-3">
      <nav aria-label="Month" className="flex items-center justify-between gap-2">
        <Link href={plannerHref("calendar", { month: grid.prev })} className="rounded-md border px-2 py-1 text-sm hover:bg-muted" aria-label="Previous month">Previous</Link>
        <h2 className="font-heading text-sm font-semibold" aria-live="polite">{grid.label}</h2>
        <Link href={plannerHref("calendar", { month: grid.next })} className="rounded-md border px-2 py-1 text-sm hover:bg-muted" aria-label="Next month">Next</Link>
      </nav>
      <div className="hidden overflow-x-auto rounded-lg border lg:block" role="region" aria-label={`Calendar for ${grid.label}`} tabIndex={0}>
        <table className="w-full table-fixed border-collapse text-xs">
          <thead><tr className="bg-muted/50 text-left text-muted-foreground">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <th key={d} scope="col" className="p-1.5 font-medium">{d}</th>)}</tr></thead>
          <tbody>
            {grid.weeks.map((week, i) => (
              <tr key={i} className="border-t align-top">
                {week.map((d) => (
                  <td key={d.date} className={`h-20 p-1 ${d.inMonth ? "" : "bg-muted/30 text-muted-foreground"} ${d.date === today ? "outline outline-1 -outline-offset-1 outline-primary" : ""}`}>
                    <span className="mb-0.5 block text-[0.6875rem] tabular-nums">{Number(d.date.slice(8))}</span>
                    <ul className="grid gap-0.5">
                      {(d.inMonth ? days.get(d.date) ?? [] : []).slice(0, 2).map((e) => <li key={e.plan.id}><Link href={`/planner/${e.plan.id}`} className="block truncate rounded bg-accent-soft px-1 py-0.5 text-accent hover:underline">{e.plan.title}</Link></li>)}
                      {(days.get(d.date)?.length ?? 0) > 2 && d.inMonth ? <li className="text-muted-foreground">+{(days.get(d.date)?.length ?? 0) - 2} more</li> : null}
                    </ul>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="lg:hidden">
        {dayList.length === 0 ? <Empty>No plans on the calendar in {grid.label}.</Empty> : (
          <ul className="grid gap-2" aria-label={`Plans in ${grid.label}`}>
            {dayList.map(([date, entries]) => <li key={date} className="rounded-lg border p-2"><p className="mb-1 text-xs font-medium tabular-nums">{date}</p><ul className="grid gap-1.5">{entries.map((e) => <li key={e.plan.id}><PlanChip plan={e.plan} /></li>)}</ul></li>)}
          </ul>
        )}
      </div>
      {undated.length > 0 && (
        <section aria-label="Plans without dates" className="rounded-lg border p-3">
          <h3 className="mb-2 text-sm font-medium">No dates yet</h3>
          <ul className="grid gap-1.5 sm:grid-cols-2">{undated.map((p) => <li key={p.id}><PlanChip plan={p} /></li>)}</ul>
        </section>
      )}
    </div>
  );
}

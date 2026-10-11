import Link from "next/link";

import { buildBoard } from "@/lib/planner/board";
import { CHANNELS, CHANNEL_KEYS } from "@/lib/planner/channels";
import { audienceViews, loadPlanViews } from "@/lib/planner/db";

import { Empty, PlanChip } from "./ui";

/** Audience rows by channel columns. Every plan is one chip in the cell where its audience and channel meet; an empty cell is a gap you can fill. */
export async function BoardTab() {
  const [audiences, plans] = await Promise.all([audienceViews(), loadPlanViews()]);
  const board = buildBoard(audiences, plans);
  if (board.rows.length === 0) return <Empty>No audiences yet. Add one in the Audiences tab.</Empty>;
  return (
    <>
      <div role="region" aria-label="Plan board by audience and channel" tabIndex={0} className="hidden overflow-x-auto rounded-lg border lg:block">
        <table className="w-full min-w-[72rem] table-fixed border-collapse text-sm">
          <thead>
            <tr className="bg-muted/50 text-left text-xs text-muted-foreground">
              <th scope="col" className="w-40 p-2 font-medium">Audience</th>
              {CHANNEL_KEYS.map((k) => <th key={k} scope="col" className="p-2 font-medium">{CHANNELS[k].label}</th>)}
            </tr>
          </thead>
          <tbody>
            {board.rows.map((row) => (
              <tr key={row.audience.id} className="border-t align-top">
                <th scope="row" className="p-2 text-left font-medium">{row.audience.name}<span className="block text-xs font-normal text-muted-foreground">{row.total} plan{row.total === 1 ? "" : "s"}</span></th>
                {CHANNEL_KEYS.map((k) => (
                  <td key={k} className="p-1.5">
                    <ul className="grid gap-1" aria-label={`${row.audience.name}, ${CHANNELS[k].label}`}>
                      {row.cells[k].map((p) => <li key={p.id}><PlanChip plan={p} /></li>)}
                      {row.cells[k].length === 0 && row.audience.id !== "archived" ? <li><Link href={`/planner?new=1&audience=${row.audience.id}&channel=${k}`} className="inline-block rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Add a plan for ${row.audience.name} on ${CHANNELS[k].label}`}>+ Add</Link></li> : null}
                    </ul>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid gap-3 lg:hidden" aria-label="Plans by audience">
        {board.rows.map((row) => (
          <li key={row.audience.id} className="rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2"><h2 className="font-heading text-sm font-semibold">{row.audience.name}</h2>{row.audience.id !== "archived" ? <Link href={`/planner?new=1&audience=${row.audience.id}`} className="text-xs text-primary underline-offset-4 hover:underline">Add plan</Link> : null}</div>
            {row.total === 0 ? <p className="mt-1 text-xs text-muted-foreground">No plans yet.</p> : (
              <ul className="mt-2 grid gap-2">
                {CHANNEL_KEYS.flatMap((k) => row.cells[k].map((p) => <li key={p.id}><p className="mb-0.5 text-[0.6875rem] text-muted-foreground">{CHANNELS[k].label}</p><PlanChip plan={p} /></li>))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

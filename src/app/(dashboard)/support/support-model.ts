import { isOpenStatus, slaOf, type SupportRow } from "@/lib/integrations/freshdesk/ticket-view";

/** The sections of the Support SLA workspace, in tab order. */
export const SUPPORT_TABS = [
  { key: "queue", label: "Queue" },
  { key: "breaching", label: "Breaching" },
  { key: "resolved", label: "Resolved" },
  { key: "workload", label: "Workload" },
] as const;
export type SupportTabKey = (typeof SUPPORT_TABS)[number]["key"];
export const SUPPORT_TAB_KEYS = SUPPORT_TABS.map((t) => t.key);

export const RESOLVED_LIMIT = 25;

export type BreachingRow = { row: SupportRow; firstResponse: boolean; resolution: boolean };

/**
 * Splits the hand-offs into what each tab shows.
 *  - queue: open and not yet picked up by an RM, most urgent first-response clock first.
 *  - breaching: open with a breached first-response or resolution clock (picked up or not), oldest due date first.
 *  - resolved: no longer open, newest first, capped.
 */
export function partitionSupport(rows: SupportRow[], now: Date) {
  const queue = rows.filter((r) => isOpenStatus(r.view.status) && !r.taskDone).sort((a, b) => a.view.firstResponseDueAt.getTime() - b.view.firstResponseDueAt.getTime());

  const breaching: BreachingRow[] = [];
  for (const row of rows) {
    if (!isOpenStatus(row.view.status)) continue;
    const sla = slaOf(row.view, now, row.taskDone ? (row.taskDoneAt ?? now) : null);
    const firstResponse = sla.response.state === "breached";
    const resolution = sla.resolution.state === "breached";
    if (firstResponse || resolution) breaching.push({ row, firstResponse, resolution });
  }
  const due = (b: BreachingRow) => Math.min(b.firstResponse ? b.row.view.firstResponseDueAt.getTime() : Infinity, b.resolution ? b.row.view.resolutionDueAt.getTime() : Infinity);
  breaching.sort((a, b) => due(a) - due(b));

  const resolved = rows
    .filter((r) => !isOpenStatus(r.view.status))
    .sort((a, b) => (b.view.resolvedAt ?? b.view.handoffAt).getTime() - (a.view.resolvedAt ?? a.view.handoffAt).getTime())
    .slice(0, RESOLVED_LIMIT);

  return { queue, breaching, resolved };
}

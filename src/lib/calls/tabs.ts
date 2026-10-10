import { parseTabParam } from "@/components/workspace/tab-logic";
import type { CallRow } from "./view-model";

/** Sections of one call, in tab order. */
export const CALL_DETAIL_TABS = [
  { key: "transcript", label: "Transcript" },
  { key: "scores", label: "Scores" },
  { key: "actions", label: "Actions" },
  { key: "recording", label: "Recording" },
] as const;
export const CALL_DETAIL_TAB_KEYS = CALL_DETAIL_TABS.map((t) => t.key);

/** The Actions tab counts everything that came up on the call: concerns, promises and objections. */
export function callDetailTabs(counts: { flagDetails: number; commitments: number; objections: number }) {
  const actions = counts.flagDetails + counts.commitments + counts.objections;
  return CALL_DETAIL_TABS.map((t) => ({ ...t, count: t.key === "actions" ? actions : null }));
}

type ListAccess = { isManager: boolean; hasCalls: boolean };

/** The list page: the calls themselves, plus the team rollup for managers once there is something to roll up. */
export function listTabs({ isManager, hasCalls }: ListAccess) {
  return [{ key: "calls", label: "Calls" }, ...(isManager && hasCalls ? [{ key: "rollup", label: "Rollup" }] : [])];
}

export function parseListTab(value: string | string[] | undefined, access: ListAccess): string {
  return parseTabParam(value, listTabs(access).map((t) => t.key), "calls");
}

/** Headline numbers for the rail, from exactly the calls in view. */
export function listStats(rows: CallRow[]) {
  const scored = rows.filter((r) => r.score !== null);
  return {
    total: rows.length,
    averageScore: scored.length === 0 ? null : Math.round(scored.reduce((sum, r) => sum + (r.score as number), 0) / scored.length),
    flagged: rows.filter((r) => r.flags.length > 0).length,
    reviewed: rows.filter((r) => r.reviewed).length,
  };
}

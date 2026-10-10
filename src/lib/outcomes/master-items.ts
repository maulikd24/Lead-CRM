import type { OutcomesViewModel } from "./view-model";

/** One line in the compact list of the Goals and outcomes screen (master-detail). Plain data: the view picks the chip. */
export type OutcomeListItem = { id: string; title: string; meta: string; status?: string; tone?: "success" | "warning" | "default" };

const SHORT = { achieved: "Achieved", ahead: "Ahead", on_track: "On track", behind: "Behind" } as const;
const GOAL_TONE = { achieved: "success", ahead: "success", on_track: "default", behind: "warning" } as const;

/** The list on the left: the overview (score and review), each goal, then the suggestions. */
export function outcomeListItems(vm: OutcomesViewModel): OutcomeListItem[] {
  const overview: OutcomeListItem = {
    id: "overview",
    title: "Score and review",
    meta: `Attention ${vm.score.value}${vm.review.hasCadence && vm.review.overdue ? " · review overdue" : ""}`,
    tone: vm.score.band === "high" ? "warning" : "default",
  };
  const goals = vm.goals.map((g): OutcomeListItem => ({ id: `goal:${g.id}`, title: g.name, meta: `${Math.round(g.progressPct)}% of target held`, status: SHORT[g.progressStatus], tone: GOAL_TONE[g.progressStatus] }));
  const n = vm.suggestions.length;
  const suggestions: OutcomeListItem = { id: "suggestions", title: "Suggestions", meta: n === 0 ? "Nothing to do" : `${n} to look at`, tone: n > 0 ? "warning" : "default" };
  return [overview, ...goals, suggestions];
}

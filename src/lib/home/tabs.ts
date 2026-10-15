import type { Role } from "@/generated/prisma/client";

/** The focus panel's tabs on the Today home and the full dashboard. Labels live here so the page and its tests agree. */
export const HOME_TABS = { myday: "My day", pipeline: "Pipeline", team: "Team", attention: "Needs attention", feed: "Needs attention" } as const;
export type HomeTabKey = keyof typeof HOME_TABS;

/**
 * Which tabs a role sees. Full dashboard: My day and Pipeline for everyone, Team for everyone except RMs (the team widgets were
 * never shown to them). Today home follows its modules (`homeModulesFor`): an RM's modules are about their own day, a manager's
 * and admin's about the team, and both get the pipeline. A manager or admin also gets a My day tab for their own work.
 * `opts.attention` adds the outcomes "Needs attention" tab (second) for those three roles. `opts.feed` (flag NEXT_PUBLIC_ATTENTION_ENGINE) adds the Attention
 * Engine feed, labelled "Needs attention", as the second tab; when both are on the outcomes tab follows it as "Goals at risk".
 */
export function homeTabsFor(role: Role, view: "today" | "full", opts: { attention?: boolean; feed?: boolean } = {}): { key: HomeTabKey; label: string }[] {
  const keys: HomeTabKey[] =
    view === "full"
      ? role === "RM"
        ? ["myday", "pipeline"]
        : ["myday", "pipeline", "team"]
      : role === "MANAGER" || role === "ADMIN"
        ? ["team", "pipeline", "myday"]
        : ["myday", "pipeline"];
  // The outcomes "Needs attention" tab (flag NEXT_PUBLIC_OUTCOMES) is the second tab for the roles that have a customer desk: it never changes which tab opens first.
  const desk = role === "ADMIN" || role === "MANAGER" || role === "RM";
  if (opts.attention && desk) keys.splice(1, 0, "attention");
  // Today is the command centre: the Needs attention feed opens first (action before overview). The full dashboard keeps it second.
  if (opts.feed && desk) keys.splice(view === "today" ? 0 : 1, 0, "feed");
  return keys.map((key) => ({ key, label: key === "attention" && opts.feed ? "Goals at risk" : HOME_TABS[key] }));
}

/** The task filter behind a My day tab: the viewer's OWN tasks. A manager's and admin's page-wide filter covers the team, so they get their own; an RM's is already their own. */
export function myDayTaskFilter<T extends object>(role: Role, userId: string, pageFilter: T): T | { assignedToId: string } {
  return role === "MANAGER" || role === "ADMIN" ? { assignedToId: userId } : pageFilter;
}

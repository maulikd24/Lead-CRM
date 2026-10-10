import type { Role } from "@/generated/prisma/client";

/** The focus panel's tabs on the Today home and the full dashboard. Labels live here so the page and its tests agree. */
export const HOME_TABS = { myday: "My day", pipeline: "Pipeline", team: "Team" } as const;
export type HomeTabKey = keyof typeof HOME_TABS;

/**
 * Which tabs a role sees. Full dashboard: My day and Pipeline for everyone, Team for everyone except RMs (the team widgets were
 * never shown to them). Today home follows its modules (`homeModulesFor`): an RM's modules are about their own day, a manager's
 * and admin's about the team, and both get the pipeline. A manager or admin also gets a My day tab for their own work.
 */
export function homeTabsFor(role: Role, view: "today" | "full"): { key: HomeTabKey; label: string }[] {
  const keys: HomeTabKey[] =
    view === "full"
      ? role === "RM"
        ? ["myday", "pipeline"]
        : ["myday", "pipeline", "team"]
      : role === "MANAGER" || role === "ADMIN"
        ? ["team", "pipeline", "myday"]
        : ["myday", "pipeline"];
  return keys.map((key) => ({ key, label: HOME_TABS[key] }));
}

/** The task filter behind a My day tab: the viewer's OWN tasks. A manager's and admin's page-wide filter covers the team, so they get their own; an RM's is already their own. */
export function myDayTaskFilter<T extends object>(role: Role, userId: string, pageFilter: T): T | { assignedToId: string } {
  return role === "MANAGER" || role === "ADMIN" ? { assignedToId: userId } : pageFilter;
}

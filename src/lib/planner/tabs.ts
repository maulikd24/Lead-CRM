import { parseTabParam } from "@/components/workspace/tab-logic";

/** The planner's sections, once. Each is a link (`?tab=`), so it deep-links, works without JS and steps through browser history. */
export const TABS = [
  { key: "board", label: "Board" },
  { key: "calendar", label: "Calendar" },
  { key: "promises", label: "Promises" },
  { key: "audiences", label: "Audiences" },
  { key: "destinations", label: "Destinations" },
  { key: "creators", label: "Creators" },
  { key: "routing", label: "Routing" },
] as const;
export type TabKey = (typeof TABS)[number]["key"];

export const parseTab = (v: string | string[] | undefined): TabKey => parseTabParam(v, TABS.map((t) => t.key), "board") as TabKey;

export const plannerHref = (tab: TabKey, extra: Record<string, string | undefined> = {}): string => {
  const q = new URLSearchParams();
  if (tab !== "board") q.set("tab", tab);
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `/planner?${s}` : "/planner";
};

/** The plan detail's sections. */
export const PLAN_TABS = [
  { key: "overview", label: "Overview" },
  { key: "links", label: "Links" },
  { key: "copy", label: "Copy" },
  { key: "funnel", label: "Funnel" },
  { key: "edit", label: "Edit" },
  { key: "history", label: "History" },
] as const;
export type PlanTabKey = (typeof PLAN_TABS)[number]["key"];
export const parsePlanTab = (v: string | string[] | undefined): PlanTabKey => parseTabParam(v, PLAN_TABS.map((t) => t.key), "overview") as PlanTabKey;

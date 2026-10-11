import { parseTabParam, tabHref } from "@/components/workspace/tab-logic";

export const TABS = [
  { key: "overview", label: "Overview" },
  { key: "events", label: "Events" },
  { key: "destinations", label: "Destinations" },
  { key: "coverage", label: "Consent coverage" },
] as const;
export type TabKey = (typeof TABS)[number]["key"];

export const parseTab = (v: string | string[] | undefined): TabKey => parseTabParam(v, TABS.map((t) => t.key), "overview") as TabKey;
export const tabLink = (key: TabKey, extra = "") => tabHref("/closed-loop", extra, key, { fallback: "overview" });

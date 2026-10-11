import { parseTabParam, tabHref } from "@/components/workspace/tab-logic";

export const TABS = [
  { key: "audit", label: "Audit" },
  { key: "actions", label: "Issues and actions" },
  { key: "waste", label: "Wasted spend" },
  { key: "timing", label: "Day and hour" },
  { key: "pacing", label: "Pacing" },
  { key: "regions", label: "Regions" },
  { key: "auction", label: "Auction" },
  { key: "tracking", label: "Tracking" },
  { key: "launch", label: "Launch drafts" },
  { key: "rules", label: "Rules" },
  { key: "ask", label: "Ask" },
  { key: "digest", label: "Weekly digest" },
] as const;
export type TabKey = (typeof TABS)[number]["key"];
export const parseTab = (v: string | string[] | undefined): TabKey => parseTabParam(v, TABS.map((t) => t.key), "audit") as TabKey;
export const tabHrefFor = (key: TabKey) => tabHref("/autopilot", "", key, { fallback: "audit" });

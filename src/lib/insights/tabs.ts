/** Sections of the agent insights page. Every card that was on the long page sits in exactly one of these. */
export const INSIGHTS_TABS = [
  { key: "overview", label: "Overview" },
  { key: "replies", label: "Replies" },
  { key: "conversion", label: "Conversion" },
  { key: "quality", label: "Cost and quality" },
] as const;
export type InsightsTabKey = (typeof INSIGHTS_TABS)[number]["key"];

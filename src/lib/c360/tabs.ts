import { parseTabParam, tabHref } from "@/components/workspace/tab-logic";

/** The sections of the Customer 360 workspace. One is on screen at a time; the URL (?tab=) says which. */
export const C360_TABS = [
  { key: "overview", label: "Overview" },
  { key: "timeline", label: "Timeline" },
  { key: "portfolio", label: "Portfolio" },
  { key: "consent", label: "Consent" },
  { key: "tickets", label: "Tickets and calls" },
] as const;

export type C360TabKey = (typeof C360_TABS)[number]["key"];

export const parseC360Tab = (value: string | string[] | undefined): C360TabKey => parseTabParam(value, C360_TABS.map((t) => t.key), "overview") as C360TabKey;

export const c360TabHref = (clientId: string, tab: C360TabKey): string => tabHref(`/clients/${clientId}/360`, "", tab, { fallback: "overview" });

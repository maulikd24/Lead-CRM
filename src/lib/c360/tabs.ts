import { parseTabParam, tabHref } from "@/components/workspace/tab-logic";

/** The sections of the Customer 360 workspace. One is on screen at a time; the URL (?tab=) says which. */
export const C360_TABS = [
  { key: "overview", label: "Overview" },
  { key: "timeline", label: "Timeline" },
  { key: "portfolio", label: "Portfolio" },
  { key: "consent", label: "Consent" },
  { key: "tickets", label: "Tickets and calls" },
] as const;

/** Added after Portfolio only while the outcomes flag (NEXT_PUBLIC_OUTCOMES) is on. */
const OUTCOMES_TAB = { key: "outcomes", label: "Goals and outcomes" } as const;

export type C360TabKey = (typeof C360_TABS)[number]["key"] | typeof OUTCOMES_TAB.key;

/** The tabs for this build: the base list, plus Goals and outcomes when its flag is on. */
export function c360Tabs(outcomesOn: boolean): readonly { key: C360TabKey; label: string }[] {
  if (!outcomesOn) return C360_TABS;
  const at = C360_TABS.findIndex((t) => t.key === "portfolio") + 1;
  return [...C360_TABS.slice(0, at), OUTCOMES_TAB, ...C360_TABS.slice(at)];
}

export const parseC360Tab = (value: string | string[] | undefined, outcomesOn = false): C360TabKey => parseTabParam(value, c360Tabs(outcomesOn).map((t) => t.key), "overview") as C360TabKey;

export const c360TabHref = (clientId: string, tab: C360TabKey): string => tabHref(`/clients/${clientId}/360`, "", tab, { fallback: "overview" });

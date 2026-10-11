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
/** Wave 2 workstream B: Memory (NEXT_PUBLIC_MEMORY) and Service (NEXT_PUBLIC_SERVICE_STATE), each only while its flag is on, placed before Consent. */
const MEMORY_TAB = { key: "memory", label: "Memory" } as const;
const SERVICE_TAB = { key: "service", label: "Service" } as const;

export type C360TabKey = (typeof C360_TABS)[number]["key"] | typeof OUTCOMES_TAB.key | typeof MEMORY_TAB.key | typeof SERVICE_TAB.key;

export type C360TabOptions = { outcomes?: boolean; memory?: boolean; service?: boolean };

/** The tabs for this build: the base list, plus the tabs whose flags are on. A plain boolean means the outcomes flag (the original signature). */
export function c360Tabs(options: boolean | C360TabOptions = {}): readonly { key: C360TabKey; label: string }[] {
  const o: C360TabOptions = typeof options === "boolean" ? { outcomes: options } : options;
  const tabs: { key: C360TabKey; label: string }[] = [...C360_TABS];
  const after = (key: C360TabKey, extra: { key: C360TabKey; label: string }[]) => tabs.splice(tabs.findIndex((t) => t.key === key) + 1, 0, ...extra);
  if (o.outcomes) after("portfolio", [OUTCOMES_TAB]);
  const wave2 = [...(o.memory ? [MEMORY_TAB] : []), ...(o.service ? [SERVICE_TAB] : [])];
  if (wave2.length) tabs.splice(tabs.findIndex((t) => t.key === "consent"), 0, ...wave2);
  return !o.outcomes && wave2.length === 0 ? C360_TABS : tabs;
}

export const parseC360Tab = (value: string | string[] | undefined, options: boolean | C360TabOptions = false): C360TabKey => parseTabParam(value, c360Tabs(options).map((t) => t.key), "overview") as C360TabKey;

export const c360TabHref = (clientId: string, tab: C360TabKey): string => tabHref(`/clients/${clientId}/360`, "", tab, { fallback: "overview" });

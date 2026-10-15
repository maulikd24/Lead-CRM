/**
 * The quick tabs above the clients list. Each is just a preset of the existing filters (status / SLA), so the URL,
 * the CSV export and every other filter keep working unchanged; picking a tab only replaces those two filters.
 */
export const CLIENT_LIST_SEGMENTS = [
  { key: "all", label: "All", params: {} },
  { key: "onboarding", label: "Onboarding", params: { status: "ACTIVE" } },
  { key: "customers", label: "Customers", params: { status: "COMPLETED" } },
  { key: "at-risk", label: "At risk", params: { status: "ACTIVE", sla: "OVERDUE" } },
  { key: "disengaged", label: "Disengaged", params: { status: "ACTIVE", disengaged: "1" } },
] as const satisfies readonly { key: string; label: string; params: { status?: string; sla?: string; disengaged?: string } }[];

export type ClientListSegment = (typeof CLIENT_LIST_SEGMENTS)[number];

const PRESET_KEYS = ["status", "sla", "disengaged"] as const;

/** The tab the current filters correspond to, or null when status/SLA/disengaged are set to something no tab covers. */
export function activeClientSegment(params: Record<string, string | undefined>): ClientListSegment["key"] | null {
  const match = CLIENT_LIST_SEGMENTS.find((segment) =>
    PRESET_KEYS.every((key) => (params[key] || undefined) === (segment.params as Record<string, string | undefined>)[key]),
  );
  return match?.key ?? null;
}

/** The list URL for a tab: the current filters, with status/SLA/disengaged swapped for the tab's and paging reset. */
export function clientSegmentHref(params: Record<string, string | undefined>, segment: ClientListSegment): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && key !== "page" && !(PRESET_KEYS as readonly string[]).includes(key)) usp.set(key, value);
  }
  for (const [key, value] of Object.entries(segment.params)) usp.set(key, value);
  const qs = usp.toString();
  return qs ? `/clients?${qs}` : "/clients";
}

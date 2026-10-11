/** Recent items in the Cmd+K palette: the last few pages and clients a person opened from it. Stored per person in the browser only. */

export type RecentEntry = { kind: "nav" | "client"; key: string; label: string; sublabel?: string; href: string };

export const RECENT_MAX = 5;

/** The new entry first, any earlier copy of it dropped, at most RECENT_MAX kept. */
export function pushRecent(list: readonly RecentEntry[], entry: RecentEntry, max = RECENT_MAX): RecentEntry[] {
  return [entry, ...list.filter((e) => !(e.kind === entry.kind && e.key === entry.key))].slice(0, max);
}

/** Reads what was stored. Anything unexpected (corrupt JSON, a link that leaves the app) is dropped rather than trusted. */
export function parseRecent(raw: string | null | undefined): RecentEntry[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const out: RecentEntry[] = [];
    for (const e of data) {
      if (!e || typeof e !== "object") continue;
      const { kind, key, label, sublabel, href } = e as Record<string, unknown>;
      if ((kind !== "nav" && kind !== "client") || typeof key !== "string" || typeof label !== "string" || typeof href !== "string") continue;
      if (!href.startsWith("/") || href.startsWith("//")) continue;
      out.push({ kind, key, label: label.slice(0, 120), sublabel: typeof sublabel === "string" ? sublabel.slice(0, 120) : undefined, href });
    }
    return out.slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

export const recentStorageKey = (userId: string) => `supportify:paletteRecent:${userId}`;

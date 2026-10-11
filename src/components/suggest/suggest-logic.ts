/** Pure logic for the suggestion stack: what is hidden, for how long, and what a swipe means. */

/** id -> DISMISSED (for good) or the time (ms since epoch) until which it is snoozed. */
export type Hidden = Record<string, number>;
export const DISMISSED = -1;
export const SNOOZE_MS = 24 * 60 * 60 * 1000;

export function visibleItems<T extends { id: string }>(items: readonly T[], hidden: Hidden, now: number): T[] {
  return items.filter((i) => {
    const h = hidden[i.id];
    return h === undefined || (h !== DISMISSED && h <= now);
  });
}

export function hideItem(hidden: Hidden, id: string, how: "snooze" | "dismiss", now: number): Hidden {
  return { ...hidden, [id]: how === "snooze" ? now + SNOOZE_MS : DISMISSED };
}

export function restoreItem(hidden: Hidden, id: string): Hidden {
  const { [id]: _removed, ...rest } = hidden;
  void _removed;
  return rest;
}

/** Remembered choices from storage: keeps dismissals and live snoozes, drops expired ones and anything that is not a number. */
export function parseHidden(raw: string | null, now: number): Hidden {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Hidden = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x === "number" && (x === DISMISSED || x > now)) out[k] = x;
    return out;
  } catch {
    return {};
  }
}

/** A swipe past 40% of the card's width decides it: right accepts, left dismisses. Anything shorter springs back. */
export function swipeOutcome(dx: number, width: number): "accept" | "dismiss" | "none" {
  const threshold = Math.max(60, width * 0.35);
  if (dx >= threshold) return "accept";
  if (dx <= -threshold) return "dismiss";
  return "none";
}

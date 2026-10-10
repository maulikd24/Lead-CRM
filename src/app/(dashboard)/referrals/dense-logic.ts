/** Pure helpers for the dense layout (kept apart so they can be tested without a browser). */

/** The selection to show: the requested item if it exists, else the first one, else none. */
export function pickSelected(ids: string[], requested: string | null | undefined): string | null {
  if (ids.length === 0) return null;
  return requested && ids.includes(requested) ? requested : ids[0];
}

/** Up/Down/Home/End within a list. Null when the key is not one of them or nothing would move. */
export function nextItem(ids: string[], current: string, key: string): string | null {
  const i = ids.indexOf(current);
  if (i < 0 || ids.length === 0) return null;
  const to = key === "ArrowDown" ? Math.min(ids.length - 1, i + 1) : key === "ArrowUp" ? Math.max(0, i - 1) : key === "Home" ? 0 : key === "End" ? ids.length - 1 : -1;
  return to < 0 || to === i ? null : ids[to];
}

export const viewAllLabel = (total: number, noun: string) => `View all (${total}) ${noun}`;

/** Pure helpers behind MasterDetail: the keyboard model and selection fallback. No React, no DOM. */

/** Up/Down move one item and stop at the ends (a list is not a ring); Home/End jump. Returns null for any other key. */
export function nextItemId(ids: readonly string[], current: string, key: string): string | null {
  if (ids.length === 0) return null;
  const i = ids.indexOf(current);
  if (key === "ArrowDown") return ids[Math.min(ids.length - 1, i + 1)];
  if (key === "ArrowUp") return ids[Math.max(0, i - 1)];
  if (key === "Home") return ids[0];
  if (key === "End") return ids[ids.length - 1];
  return null;
}

/** The selected id if it exists, else the first item (a stale or hand-edited ?item= never leaves the detail blank). */
export function resolveSelected(ids: readonly string[], requested: string | null | undefined): string | null {
  if (ids.length === 0) return null;
  return requested && ids.includes(requested) ? requested : ids[0];
}

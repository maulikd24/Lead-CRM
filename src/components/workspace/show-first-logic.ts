/** Pure helpers behind ShowFirst: how many rows show before "View all". */

export function splitShowFirst(total: number, limit: number): { shown: number; hidden: number; needsViewAll: boolean } {
  const n = Math.max(1, Math.floor(limit));
  const shown = Math.min(total, n);
  return { shown, hidden: total - shown, needsViewAll: total > n };
}

/** "View all (12)", or "View all 12 tasks" when a noun is given. The number is always the TOTAL, never the hidden count. */
export function viewAllLabel(total: number, noun?: string): string {
  return noun ? `View all ${total} ${noun}` : `View all (${total})`;
}

/**
 * Generic combinator implementing the same invariant buildClientWhere already established for
 * assignedToId: a user-supplied filter value is honored ONLY if it's within the caller's own
 * visible set; otherwise the caller's visibility list is used as-is. Never allows a supplied
 * filter to widen access beyond what the caller could already see.
 */
export function narrowToVisibleIds(
  requested: string | undefined,
  visible: string[] | null,
): string | { in: string[] } | undefined {
  if (requested && (!visible || visible.includes(requested))) return requested;
  if (visible) return { in: visible };
  return undefined;
}

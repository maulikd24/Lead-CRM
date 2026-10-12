import type { CustomerIdentity } from "./mapper";

/** ALL client ids found for each identifier the sender supplied (empty list = that identifier matched nobody).
 * The lookup must not collapse several customers into one: sharing a number or email is common. */
export type IdentityHits = Partial<Record<keyof CustomerIdentity, string[]>>;

export type MatchResult =
  | { status: "matched"; clientId: string }
  | { status: "unmatched"; code?: "NO_STRONG_ID" }
  | { status: "ambiguous" };

/**
 * Financial data must never land on the wrong customer, so only a strong identifier may authorise a write:
 * - `clientCode` or `pan` is required. Neither supplied: unmatched (NO_STRONG_ID), whatever mobile/email say.
 * - A supplied strong identifier that matches nobody: unmatched (a typo is never rescued by another identifier).
 * - clientCode and pan pointing at different customers, or one matching several: ambiguous.
 * - mobile and email only corroborate: when supplied and they match customers, the strong customer must be among
 *   them, otherwise ambiguous. They matching nobody (a new number) is fine.
 */
export function resolveMatch(hits: IdentityHits): MatchResult {
  const strong = [hits.clientCode, hits.pan].filter((l): l is string[] => l !== undefined);
  if (strong.length === 0) return { status: "unmatched", code: "NO_STRONG_ID" };

  const ids = new Set<string>();
  for (const list of strong) {
    const distinct = new Set(list);
    if (distinct.size === 0) return { status: "unmatched" };
    if (distinct.size > 1) return { status: "ambiguous" };
    ids.add([...distinct][0]);
  }
  if (ids.size > 1) return { status: "ambiguous" };
  const clientId = [...ids][0];

  for (const list of [hits.phoneKey, hits.email]) {
    if (list && list.length > 0 && !list.includes(clientId)) return { status: "ambiguous" };
  }
  return { status: "matched", clientId };
}

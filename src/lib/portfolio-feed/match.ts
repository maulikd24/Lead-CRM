import type { CustomerIdentity } from "./mapper";

/** Client ids found for each identifier the sender supplied (empty list = that identifier matched nobody). */
export type IdentityHits = Partial<Record<keyof CustomerIdentity, string[]>>;

export type MatchResult = { status: "matched"; clientId: string } | { status: "unmatched" } | { status: "ambiguous" };

/**
 * Financial data must never land on the wrong customer, so the rule is strict:
 * - every identifier that matched somebody must point at the same single customer;
 * - an identifier that matched nobody is ignored when another one matched (e.g. an updated email);
 * - two identifiers pointing at different customers, or one identifier matching several customers, is "ambiguous"
 *   and nothing is written;
 * - no match at all is "unmatched": the customer is reported, never created.
 */
export function resolveMatch(hits: IdentityHits): MatchResult {
  const ids = new Set<string>();
  for (const list of Object.values(hits)) {
    if (!list) continue;
    if (new Set(list).size > 1) return { status: "ambiguous" };
    for (const id of list) ids.add(id);
  }
  if (ids.size === 0) return { status: "unmatched" };
  if (ids.size > 1) return { status: "ambiguous" };
  return { status: "matched", clientId: [...ids][0] };
}

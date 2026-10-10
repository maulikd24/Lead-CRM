import { createHash } from "node:crypto";

/**
 * The tombstone for a signup/lead ledger row's (source, externalId) key after its person is erased.
 *
 * The key is kept (as a one-way hash) so a replayed submission of the same id is still recognised and acknowledged
 * instead of creating the person again from a fresh payload. Trade-off: anyone holding the original id can recompute
 * the hash and learn that this id was erased, and a guessable id could be confirmed by brute force. Ids from the app
 * and from ad platforms are opaque, so this is accepted; raw personal data is never kept.
 */
export function erasedLedgerKey(source: string, externalId: string): string {
  return `erased:${createHash("sha256").update(`${source}\u0000${externalId}`).digest("hex")}`;
}

export const isErasedLedgerKey = (externalId: string) => /^erased:[0-9a-f]{64}$/.test(externalId);

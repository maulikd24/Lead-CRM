import { comparableEmail, comparablePhone, type Identity } from "./duplicate-score";

/**
 * A mobile/email shared by more than this many customers (an office line, a broker's number, a
 * placeholder) is skipped and reported instead of expanded: 1,000 sharers would otherwise mean
 * ~500k pairs, all of them noise. 50 members = at most 1,225 pairs per bucket.
 */
export const MAX_BUCKET_SIZE = 50;

export type SkippedBucket = { kind: "mobile" | "email"; key: string; size: number };

/**
 * Pure: groups customers by normalised mobile and email (hash buckets, no O(n^2) over all rows)
 * and expands each bucket into pairs ordered so a.id < b.id, de-duplicated across buckets.
 * PAN is deliberately not a bucket: PAN collisions are a hard block at creation.
 */
export function findCandidatePairs(rows: Identity[]): { pairs: [Identity, Identity][]; skippedBuckets: SkippedBucket[] } {
  const buckets = new Map<string, { kind: "mobile" | "email"; key: string; members: Identity[] }>();
  const add = (kind: "mobile" | "email", key: string | null, row: Identity) => {
    if (!key) return;
    const id = `${kind}:${key}`;
    const b = buckets.get(id) ?? { kind, key, members: [] };
    b.members.push(row);
    buckets.set(id, b);
  };
  for (const r of rows) {
    add("mobile", comparablePhone(r.mobile), r);
    add("email", comparableEmail(r.email), r);
  }
  const seen = new Set<string>();
  const pairs: [Identity, Identity][] = [];
  const skippedBuckets: SkippedBucket[] = [];
  for (const { kind, key, members } of buckets.values()) {
    if (members.length > MAX_BUCKET_SIZE) { skippedBuckets.push({ kind, key, size: members.length }); continue; }
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const [a, b] = members[i].id < members[j].id ? [members[i], members[j]] : [members[j], members[i]];
        if (a.id === b.id) continue;
        const k = `${a.id}:${b.id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        pairs.push([a, b]);
      }
    }
  }
  return { pairs, skippedBuckets };
}

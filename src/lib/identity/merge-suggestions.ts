import { prisma } from "@/lib/db/prisma";
import { findCandidatePairs, type SkippedBucket } from "./candidate-pairs";
import { scoreDuplicate, SUGGESTION_THRESHOLD } from "./duplicate-score";

/**
 * Suggest-only: records likely duplicate customers as OPEN MergeSuggestion rows for a human to review.
 * Never merges and never writes to Client. Re-running is idempotent (unique on the ordered pair).
 * Only the `limit` most recent live customers are considered (bucketed by mobile/email, not O(n^2)).
 */
export async function generateMergeSuggestions(limit = 500): Promise<{ created: number; candidates: number; skippedBuckets: SkippedBucket[] }> {
  const rows = await prisma.client.findMany({
    where: { isDeleted: false, mergedIntoId: null },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, name: true, mobile: true, email: true, pan: true },
  });
  const { pairs, skippedBuckets } = findCandidatePairs(rows);
  const data: { clientAId: string; clientBId: string; score: number; reasons: string[] }[] = [];
  for (const [a, b] of pairs) {
    const { score, reasons } = scoreDuplicate(a, b);
    if (score >= SUGGESTION_THRESHOLD) data.push({ clientAId: a.id, clientBId: b.id, score, reasons });
  }
  const res = data.length ? await prisma.mergeSuggestion.createMany({ data, skipDuplicates: true }) : { count: 0 };
  return { created: res.count, candidates: pairs.length, skippedBuckets };
}

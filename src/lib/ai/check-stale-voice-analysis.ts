import { prisma } from "@/lib/db/prisma";

// If Exotel's ExoVoiceAnalyze callback never arrives (API error, misconfigured callback_url,
// Exotel-side failure), a review would otherwise sit in PENDING_TRANSCRIPT forever with no
// visibility. This sweep marks it FAILED after a generous grace period — a safety net, not the
// happy path (which is event-driven: see src/app/api/webhooks/[provider]/route.ts).
const STALE_AFTER_MS = 2 * 60 * 60 * 1000; // 2h — placeholder, tune once real callback latency is observed

export async function checkStaleVoiceAnalysis(): Promise<{ markedFailed: number }> {
  const stale = await prisma.conversationReview.findMany({
    where: { sourceType: "CALL", status: "PENDING_TRANSCRIPT", createdAt: { lte: new Date(Date.now() - STALE_AFTER_MS) } },
    select: { id: true },
    take: 200,
  });

  for (const review of stale) {
    await prisma.conversationReview.update({
      where: { id: review.id },
      data: { status: "FAILED", failureReason: "Exotel's ExoVoiceAnalyze callback did not arrive within the expected window" },
    });
  }

  return { markedFailed: stale.length };
}

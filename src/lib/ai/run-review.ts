import { prisma } from "@/lib/db/prisma";
import { analyzeConversation, ANALYSIS_MODEL } from "@/lib/ai/analyze-conversation";
import { createTaskIfNotExists } from "@/lib/stage-engine/create-task-if-not-exists";

const LOW_SCORE_THRESHOLD = 50;
const DEFAULT_DUE_HOURS = 24;
const URGENT_DUE_HOURS = 4;

/**
 * Runs the Claude analysis for a ConversationReview that already has a transcript, persists the
 * result, and triggers the follow-up Task + Notification wiring. Never throws past this function —
 * a failure is recorded as ConversationReview.status = "FAILED" instead, matching the
 * degrade-gracefully convention already established for this kind of background work
 * (src/lib/notifications/send-sla-breach-email.ts).
 */
export async function runReview(reviewId: string): Promise<void> {
  const review = await prisma.conversationReview.findUnique({
    where: { id: reviewId },
    include: { client: { include: { assignedTo: true } } },
  });
  if (!review || !review.transcript) return;

  try {
    const analysis = await analyzeConversation({ transcript: review.transcript, sourceType: review.sourceType });

    const dueInHours = analysis.recommendation.suggestedDueInHours ?? (analysis.sentiment.label === "negative" || analysis.qualityScore < LOW_SCORE_THRESHOLD ? URGENT_DUE_HOURS : DEFAULT_DUE_HOURS);

    const updated = await prisma.conversationReview.update({
      where: { id: review.id },
      data: {
        status: "ANALYZED",
        sentimentLabel: analysis.sentiment.label,
        sentimentScore: analysis.sentiment.score,
        sentimentReasoning: analysis.sentiment.reasoning,
        qualityScore: analysis.qualityScore,
        qualityBreakdown: analysis.qualityBreakdown,
        recommendationText: analysis.recommendation.text,
        recommendationKind: analysis.recommendation.kind,
        recommendationDueAt: new Date(Date.now() + dueInHours * 60 * 60 * 1000),
        aiModel: ANALYSIS_MODEL,
        aiRawResponse: analysis,
        analyzedAt: new Date(),
      },
    });

    const assignedToId = updated.assignedRmId ?? review.client.assignedToId;

    if (analysis.recommendation.kind !== "none" && assignedToId) {
      const task = await createTaskIfNotExists({
        clientId: review.clientId,
        assignedToId,
        title: analysis.recommendation.text,
        dueAt: updated.recommendationDueAt!,
        source: `quality-audit:${review.id}`,
      });
      await prisma.conversationReview.update({ where: { id: review.id }, data: { taskId: task.id } });
    }

    const isLowScoreOrNegative = analysis.qualityScore < LOW_SCORE_THRESHOLD || analysis.sentiment.label === "negative";
    if (isLowScoreOrNegative && assignedToId) {
      const alreadyNotified = await prisma.notification.findFirst({
        where: { type: "quality_review_low_score", readAt: null, payload: { path: ["reviewId"], equals: review.id } },
      });
      if (!alreadyNotified) {
        await prisma.notification.create({
          data: {
            userId: assignedToId,
            type: "quality_review_low_score",
            payload: { reviewId: review.id, clientId: review.clientId, clientName: review.client.name, qualityScore: analysis.qualityScore, sentimentLabel: analysis.sentiment.label },
          },
        });

        if (review.client.priority === "HIGH" && review.client.assignedTo?.managerId) {
          await prisma.notification.create({
            data: {
              userId: review.client.assignedTo.managerId,
              type: "quality_review_low_score",
              payload: {
                reviewId: review.id,
                clientId: review.clientId,
                clientName: review.client.name,
                qualityScore: analysis.qualityScore,
                sentimentLabel: analysis.sentiment.label,
                assignedToName: review.client.assignedTo.name,
                escalated: true,
              },
            },
          });
        }
      }
    }
  } catch (error) {
    await prisma.conversationReview.update({
      where: { id: review.id },
      data: { status: "FAILED", failureReason: error instanceof Error ? error.message : "Unknown error during analysis" },
    });
  }
}

import { prisma } from "@/lib/db/prisma";
import { runReview } from "@/lib/ai/run-review";

const BATCH_SIZE = 200;
const MESSAGE_LIMIT = 300; // matches THREAD_LIMIT in src/lib/whatsapp/inbox-queries.ts

type CandidateRow = { clientId: string };

/**
 * Periodic sweep for WhatsApp — there's no single "conversation ended" event the way calls have,
 * so this finds clients with message activity since their last WHATSAPP_THREAD review's
 * coveredToAt watermark (or ever, if none exists), compiles the recent thread into text, and runs
 * the same Claude analysis calls use. Modeled on processDueJourneySteps's sweep shape
 * (src/lib/journeys/poller.ts): findMany + take + a simple sequential loop, no daily mutex.
 */
export async function sweepWhatsAppConversationReviews(): Promise<{ processed: number }> {
  const candidates = await prisma.$queryRaw<CandidateRow[]>`
    SELECT DISTINCT m."clientId"
    FROM "Message" m
    WHERE m."accountId" IS NOT NULL
      AND m."createdAt" > COALESCE(
        (SELECT MAX(cr."coveredToAt") FROM "ConversationReview" cr WHERE cr."clientId" = m."clientId" AND cr."sourceType" = 'WHATSAPP_THREAD'),
        TIMESTAMP '1970-01-01'
      )
    LIMIT ${BATCH_SIZE}
  `;

  let processed = 0;
  for (const { clientId } of candidates) {
    const [messages, client] = await Promise.all([
      prisma.message.findMany({
        where: { clientId, accountId: { not: null } },
        orderBy: { createdAt: "asc" },
        take: MESSAGE_LIMIT,
        select: { body: true, direction: true, createdAt: true },
      }),
      prisma.client.findUnique({ where: { id: clientId }, select: { assignedToId: true } }),
    ]);
    if (messages.length === 0) continue;

    const compiled = messages.map((m) => `[${m.direction}] ${m.body}`).join("\n");
    const review = await prisma.conversationReview.create({
      data: {
        clientId,
        sourceType: "WHATSAPP_THREAD",
        transcript: compiled,
        coveredFromAt: messages[0].createdAt,
        coveredToAt: messages[messages.length - 1].createdAt,
        assignedRmId: client?.assignedToId ?? null,
        status: "ANALYZING",
      },
    });

    await runReview(review.id);
    processed += 1;
  }

  return { processed };
}

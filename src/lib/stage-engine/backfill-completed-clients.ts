import { prisma } from "@/lib/db/prisma";
import { getStageByName } from "./stages";
import { correctStage } from "./transitions";
import { getSystemActorId } from "@/lib/system/system-actor";

/**
 * One-time, idempotent backfill for clients that reached Client.status = COMPLETED under the old
 * silent auto-completion model (before "Onboarding Completed" existed as a real stage). Without
 * this, a legacy-completed client's currentStageId would still point at "Introduction with Dealer"
 * — no longer the last stage — and would stop rendering correctly in the stage tracker. Safe to
 * leave wired into the cron job permanently: once every such client is moved, this is a no-op.
 */
export async function backfillCompletedClientsToFinalStage() {
  const finalStage = await getStageByName("Onboarding Completed");

  const stale = await prisma.client.findMany({
    where: { status: "COMPLETED", currentStageId: { not: finalStage.id } },
    select: { id: true },
  });

  if (stale.length === 0) return { backfilled: 0 };

  const systemActorId = await getSystemActorId();
  for (const client of stale) {
    await correctStage(
      client.id,
      finalStage.id,
      "Backfilled: already completed under the previous invisible-completion model",
      systemActorId,
    );
  }

  return { backfilled: stale.length };
}

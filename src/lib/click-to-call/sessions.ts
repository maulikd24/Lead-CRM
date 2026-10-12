import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/activities/log-activity";
import { ACTIVE_CALL_STATUSES, STALE_CALL_MINUTES, callStatusFromExotel } from "@/lib/click-to-call/policy";
import type { CallSession } from "@/generated/prisma/client";

/** A mock call "rings" this long before it connects in the widget. */
export const MOCK_RING_MS = 4000;

const OUTCOME_TEXT: Record<string, string> = {
  COMPLETED: "Outbound call completed",
  NO_ANSWER: "Outbound call — no answer",
  BUSY: "Outbound call — busy",
  FAILED: "Outbound call failed",
};

export async function findCallSessionByCallId(callId: string) {
  return prisma.callSession.findUnique({ where: { providerCallId: callId }, include: { client: true } });
}

/** The user's call still in progress, if any (calls with no news for STALE_CALL_MINUTES don't count). */
export async function activeCallFor(userId: string, now = new Date()) {
  return prisma.callSession.findFirst({
    where: { userId, status: { in: [...ACTIVE_CALL_STATUSES] }, startedAt: { gte: new Date(now.getTime() - STALE_CALL_MINUTES * 60_000) } },
    orderBy: { startedAt: "desc" },
  });
}

export async function markCallAnswered(sessionId: string, at = new Date()) {
  await prisma.callSession.updateMany({ where: { id: sessionId, status: "QUEUED" }, data: { status: "IN_PROGRESS", answeredAt: at } });
}

/**
 * Finishes a call once: records the outcome and duration on the session and logs one CALL activity on the client, by the user who
 * placed it. A repeated callback finds the session already ended and does nothing (returns created: false).
 */
export async function completeCallSession(
  session: Pick<CallSession, "id" | "clientId" | "userId" | "provider" | "providerCallId" | "answeredAt">,
  result: { status?: string; durationSeconds?: number; recordingUrl?: string },
  now = new Date(),
) {
  const status = callStatusFromExotel(result.status);
  const finalStatus = status === "IN_PROGRESS" ? "COMPLETED" : status;
  const claimed = await prisma.callSession.updateMany({
    where: { id: session.id, status: { in: [...ACTIVE_CALL_STATUSES] } },
    data: { status: finalStatus, endedAt: now, durationSeconds: result.durationSeconds ?? null },
  });
  if (claimed.count === 0) return { created: false as const };

  const activity = await logActivity({
    clientId: session.clientId,
    userId: session.userId,
    type: "CALL",
    payload: {
      source: session.provider,
      eventType: "call_completed",
      callSid: session.providerCallId,
      status: finalStatus.toLowerCase(),
      direction: "Outbound",
      origin: "click-to-call",
      durationSeconds: result.durationSeconds,
      recordingUrl: result.recordingUrl,
      message: OUTCOME_TEXT[finalStatus] ?? "Outbound call",
    },
  });
  await prisma.callSession.update({ where: { id: session.id }, data: { activityId: activity.id } });
  return { created: true as const, activity, status: finalStatus };
}

/**
 * Mock calls have no Exotel to report back, so the widget's own polling plays them out: ringing for MOCK_RING_MS, then connected
 * until the user presses End.
 */
export async function advanceMockCall(session: CallSession, now = new Date()): Promise<CallSession> {
  if (!session.mock || session.status !== "QUEUED" || now.getTime() - session.startedAt.getTime() < MOCK_RING_MS) return session;
  const answeredAt = new Date(session.startedAt.getTime() + MOCK_RING_MS);
  await markCallAnswered(session.id, answeredAt);
  return { ...session, status: "IN_PROGRESS", answeredAt };
}

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { CALLS_ROLES, callsReviewEnabled } from "@/lib/calls/flag";
import { allowedRecordingHosts, streamRecording } from "@/lib/calls/recording";
import { canViewCall, parseCallPayload } from "@/lib/calls/view-model";

/**
 * Streams a call recording to a signed-in viewer who is allowed to see that call. The telephony provider's URL stays on
 * the server (it is never sent to the browser), only provider hosts are fetched, and nothing is cached.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!callsReviewEnabled()) return new NextResponse("Not found", { status: 404 });
  const session = await auth();
  if (!session?.user || session.user.mustChangePassword) return new NextResponse("Unauthorized", { status: 401 });

  if (!(CALLS_ROLES as readonly string[]).includes(session.user.role)) return new NextResponse("Not found", { status: 404 });

  const limited = await rateLimit("calls:recording", session.user.id ?? clientIp(request), { limit: 120, windowSeconds: 60 });
  if (!limited.allowed) return tooManyRequests(limited);

  const { id } = await params;
  const scope = await getVisibleUserIds(session.user.id, session.user.role);
  const activity = await prisma.activity.findFirst({
    where: { id, type: "CALL", client: { isDeleted: false } },
    select: { payload: true, userId: true, client: { select: { assignedToId: true } }, conversationReview: { select: { assignedRmId: true } } },
  });
  if (!activity || !canViewCall(scope, { rmId: activity.conversationReview?.assignedRmId ?? null, activityUserId: activity.userId, clientAssignedToId: activity.client.assignedToId })) {
    return new NextResponse("Not found", { status: 404 });
  }

  const recordingUrl = parseCallPayload(activity.payload).recordingUrl;
  if (!recordingUrl) return new NextResponse("Not found", { status: 404 });

  return streamRecording({
    url: recordingUrl,
    range: request.headers.get("range"),
    hosts: allowedRecordingHosts(process.env.CALLS_RECORDING_HOSTS),
    fetchImpl: fetch,
    signal: request.signal,
  });
}

"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { DESK_ROLES, loadClientInScope } from "@/lib/clients/load-in-scope";
import { requireRole } from "@/lib/auth/require-role";
import { getAdapter, isMockAdapter } from "@/lib/integrations/registry";
import { isProductionRuntime } from "@/lib/security/webhook-auth";
import { rateLimit } from "@/lib/security/rate-limit";
import { checkConsent } from "@/lib/consent/enforce";
import { callBlockReason, exotelNumber, isValidCallPhone } from "@/lib/click-to-call/policy";
import { activeCallFor, advanceMockCall, completeCallSession } from "@/lib/click-to-call/sessions";

// Generous for real work (a call every 30 seconds), tight enough to stop a runaway script from dialling clients.
const CALL_RATE_LIMIT = { limit: 20, windowSeconds: 600 };

type Result<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

/**
 * Click-to-call: rings the signed-in user's own phone, then connects the client, through Exotel. Only for a client the user can
 * open, inside calling hours, never to someone who has opted out of calls, one call at a time. Returns a reason instead of
 * throwing, so the message reaches the user (Next.js hides thrown messages in production).
 */
export async function startClientCallAction(clientId: string): Promise<Result<{ sessionId: string; mock: boolean }>> {
  await requireRole([...DESK_ROLES]);
  const { session, client } = await loadClientInScope(clientId, {});
  const [user, active, consent, adapter] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { callPhone: true } }),
    activeCallFor(session.user.id),
    checkConsent(client.id, "SERVICE_COMMS", "call"),
    getAdapter("exotel"),
  ]);
  const mock = isMockAdapter(adapter);
  if (mock && isProductionRuntime()) return { ok: false, reason: "Calling isn't connected yet — an Admin needs to set up Exotel in Apps & Integrations." };

  const blocked = callBlockReason({
    now: new Date(),
    clientStatus: client.status,
    clientMobile: client.mobile,
    callerPhone: user.callPhone,
    consentAllowed: consent.allowed,
    hasActiveCall: !!active,
  });
  if (blocked) return { ok: false, reason: blocked };

  const limited = await rateLimit("click-to-call", session.user.id, CALL_RATE_LIMIT);
  if (!limited.allowed) return { ok: false, reason: "Too many calls in a short time — try again in a few minutes." };

  // Exotel records only when the client hasn't refused call recording (always, while consent enforcement is off).
  const recording = await checkConsent(client.id, "CALL_RECORDING", "call");
  const placed = await adapter.actions.clickToCall(client, {
    agentPhone: exotelNumber(user.callPhone),
    customerPhone: exotelNumber(client.mobile),
    record: recording.allowed,
  });
  const callSid = placed.success ? (placed.data as { callSid?: string } | undefined)?.callSid : undefined;
  if (!placed.success || !callSid) {
    console.error("Click-to-call failed", placed.success ? "no call id" : placed.error);
    return { ok: false, reason: "Exotel couldn't place the call. Try again, or call from your phone." };
  }

  const call = await prisma.callSession.create({
    data: { clientId: client.id, userId: session.user.id, provider: "exotel", providerCallId: callSid, mock },
    select: { id: true },
  });
  return { ok: true, sessionId: call.id, mock };
}

/** The live call widget's view of one of the user's own calls. */
export async function getCallSessionAction(sessionId: string) {
  const session = await requireUser();
  const row = await prisma.callSession.findFirst({ where: { id: sessionId, userId: session.user.id } });
  if (!row) return null;
  const call = await advanceMockCall(row);
  const client = await prisma.client.findUnique({ where: { id: call.clientId }, select: { id: true, name: true } }); // never the number: the call is placed server-side
  return {
    id: call.id,
    status: call.status,
    mock: call.mock,
    startedAt: call.startedAt,
    answeredAt: call.answeredAt,
    endedAt: call.endedAt,
    durationSeconds: call.durationSeconds,
    client,
  };
}

export type CallSessionView = NonNullable<Awaited<ReturnType<typeof getCallSessionAction>>>;

/** Mock calls only (local and Preview): ends the call the way Exotel's final callback would. A real call ends on the phone. */
export async function endMockCallAction(sessionId: string): Promise<Result> {
  const session = await requireUser();
  const row = await prisma.callSession.findFirst({ where: { id: sessionId, userId: session.user.id, mock: true } });
  if (!row || isProductionRuntime()) return { ok: false, reason: "Only a test call can be ended from here." };
  const now = new Date();
  const answered = row.answeredAt ?? (row.status === "IN_PROGRESS" ? row.startedAt : null);
  await completeCallSession(row, {
    status: answered ? "completed" : "no-answer",
    durationSeconds: answered ? Math.max(1, Math.round((now.getTime() - answered.getTime()) / 1000)) : 0,
  }, now);
  revalidatePath(`/clients/${row.clientId}`);
  return { ok: true };
}

/** Sets the signed-in user's own calling number (the phone Exotel rings first). Blank removes it. */
export async function setOwnCallPhoneAction(raw: string): Promise<Result> {
  const session = await requireUser();
  const value = raw.trim();
  if (value && !isValidCallPhone(value)) return { ok: false, reason: "Enter a 10-digit Indian mobile number." };
  await prisma.user.update({ where: { id: session.user.id }, data: { callPhone: value || null } });
  revalidatePath("/settings/account");
  return { ok: true };
}

/** The signed-in user's call still in progress, so the widget reappears after a reload or on another page. */
export async function getMyActiveCallIdAction(): Promise<string | null> {
  const session = await requireUser();
  return (await activeCallFor(session.user.id))?.id ?? null;
}

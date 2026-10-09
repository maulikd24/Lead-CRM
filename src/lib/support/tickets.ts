import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/activities/log-activity";
import type { Prisma } from "@/generated/prisma/client";
import type { SupportTicketData } from "@/lib/integrations/types";

export type TicketOrigin = "webhook" | "history-sync" | "supportify";

/**
 * Records a helpdesk ticket on a client — from the ticket webhooks, the history sync, or a ticket Supportify raised.
 * First sighting: one TICKET activity, dated when the ticket was raised (so history lands in the right place on
 * the timeline). Every later update changes that row and that same activity — never a new timeline entry.
 * A ticket stays with the client it was first linked to, unless that client has since been merged away or archived.
 */
export async function upsertSupportTicket(clientId: string, provider: string, ticket: SupportTicketData, origin: TicketOrigin) {
  const existing = await prisma.supportTicket.findUnique({
    where: { provider_externalId: { provider, externalId: ticket.externalId } },
    include: { client: { select: { isDeleted: true, mergedIntoId: true } } },
  });

  const fields = {
    // A field the source didn't send keeps its stored value (e.g. a status-only update keeps the subject).
    ...(ticket.subject != null ? { subject: ticket.subject } : {}),
    ...(ticket.status != null ? { status: ticket.status } : {}),
    ...(ticket.priority != null ? { priority: ticket.priority } : {}),
    ...(ticket.channel != null ? { channel: ticket.channel } : {}),
    ticketUpdatedAt: ticket.updatedAt ?? new Date(),
    lastSyncedAt: new Date(),
  };

  if (!existing) {
    const created = await prisma.supportTicket.create({
      data: { clientId, provider, externalId: ticket.externalId, ticketCreatedAt: ticket.createdAt ?? new Date(), ...fields },
    });
    const activity = await logActivity({
      clientId,
      type: "TICKET",
      payload: activityPayload(provider, created, origin),
      createdAt: created.ticketCreatedAt ?? undefined,
    });
    await prisma.supportTicket.update({ where: { id: created.id }, data: { activityId: activity.id } });
    return { ticket: created, isNew: true };
  }

  const ownerGone = existing.client.isDeleted || existing.client.mergedIntoId !== null;
  const updated = await prisma.supportTicket.update({
    where: { id: existing.id },
    data: {
      ...fields,
      // When a ticket was raised never changes — only fill it in if it was unknown.
      ...(!existing.ticketCreatedAt && ticket.createdAt ? { ticketCreatedAt: ticket.createdAt } : {}),
      ...(ownerGone && existing.clientId !== clientId ? { clientId } : {}),
    },
  });
  if (updated.activityId) {
    // Same timeline entry, current details. updateMany: tolerate an activity that was removed.
    await prisma.activity.updateMany({
      where: { id: updated.activityId },
      data: { payload: activityPayload(provider, updated, origin), ...(updated.clientId !== existing.clientId ? { clientId: updated.clientId } : {}) },
    });
  }
  return { ticket: updated, isNew: false };
}

function activityPayload(
  provider: string,
  t: { externalId: string; subject: string | null; status: string | null; priority: string | null; channel: string | null },
  origin: TicketOrigin,
): Prisma.InputJsonValue {
  return {
    source: provider,
    eventType: "ticket",
    ticketId: t.externalId,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    channel: t.channel,
    origin,
  };
}

import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/activities/log-activity";
import { resolveInboundClient } from "@/lib/clients/inbound-contact";
import { saveExtraction } from "@/lib/intelligence/extract";
import { createTaskIfNotExists } from "@/lib/stage-engine/create-task-if-not-exists";
import type { Prisma } from "@/generated/prisma/client";

import { handoffEnabled } from "./flags";
import { processHandoff, type HandoffDeps, type HandoffResult } from "./handoff";
import { isHandoffPayload } from "./normalize";

/** The real, database-backed dependencies. Tests inject fakes instead. */
export const prismaHandoffDeps: HandoffDeps = {
  now: () => new Date(),

  async resolveClient(contact) {
    const { client } = await resolveInboundClient({ phone: contact.phone, email: contact.email, name: contact.name, leadSource: "Support hand-off" });
    return { id: client.id, assignedToId: client.assignedToId, name: client.name };
  },

  async findExisting(clientId, ticketId) {
    const row = await prisma.activity.findFirst({
      where: {
        clientId,
        type: "TICKET",
        AND: [{ payload: { path: ["handoff"], equals: true } }, { payload: { path: ["ticketId"], equals: ticketId } }],
      },
      select: { id: true, payload: true },
    });
    return row ? { id: row.id, payload: row.payload as Record<string, unknown> } : null;
  },

  // First hand-off sighting. The ticket may already be on the customer (the Freshdesk history sync records every ticket in
  // SupportTicket + one TICKET activity): then that timeline entry becomes the hand-off entry, so there is only one. Otherwise
  // create the entry and the SupportTicket row, so a later history sync adopts it instead of adding a second one.
  async createActivity(clientId, payload, createdAt) {
    const ticketId = String(payload.ticketId);
    const known = await prisma.supportTicket.findUnique({ where: { provider_externalId: { provider: "freshdesk", externalId: ticketId } }, select: { id: true, clientId: true, activityId: true } });
    if (known?.activityId && known.clientId === clientId) {
      const updated = await prisma.activity.updateMany({ where: { id: known.activityId }, data: { payload: payload as Prisma.InputJsonValue } });
      if (updated.count === 1) return { id: known.activityId };
    }
    const a = await logActivity({ clientId, type: "TICKET", payload: payload as Prisma.InputJsonValue, createdAt });
    if (!known) {
      const text = (v: unknown) => (typeof v === "string" ? v : null);
      await prisma.supportTicket.create({
        data: { clientId, provider: "freshdesk", externalId: ticketId, subject: text(payload.subject), status: text(payload.ticketStatus), priority: text(payload.ticketPriority), channel: text(payload.channel), ticketCreatedAt: createdAt, ticketUpdatedAt: createdAt, activityId: a.id },
      });
    }
    return { id: a.id };
  },

  async updateActivity(id, payload) {
    await prisma.activity.update({ where: { id }, data: { payload: payload as Prisma.InputJsonValue } });
  },

  async createTask(task) {
    const t = await createTaskIfNotExists(task);
    return { id: t.id };
  },

  // An open COMPLAINT insight is what the situations engine reads as "service_issue" (severity high), and the
  // next-best-action engine then puts service resolution ahead of every sales programme.
  async recordServiceIssue({ clientId, activityId, text, occurredAt }) {
    await saveExtraction({ clientId, sourceType: "TICKET", sourceRef: activityId, occurredAt, extraction: { insights: [{ kind: "COMPLAINT", text, severity: "high" }] } });
  },

  log: (message) => console.info(message),
};

/**
 * The webhook route's single entry point. Returns null (route behaves exactly as before) unless the flag is on, the
 * provider is Freshdesk and the payload is tagged as an AI hand-off.
 */
export async function maybeHandleHandoff(provider: string, payload: unknown, deps: HandoffDeps = prismaHandoffDeps): Promise<HandoffResult | null> {
  if (provider !== "freshdesk" || !handoffEnabled() || !isHandoffPayload(payload)) return null;
  return processHandoff(payload, deps);
}

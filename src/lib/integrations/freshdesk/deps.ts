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

  async createActivity(clientId, payload, createdAt) {
    const a = await logActivity({ clientId, type: "TICKET", payload: payload as Prisma.InputJsonValue, createdAt });
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

import { createHash } from "node:crypto";

import { prisma } from "@/lib/db/prisma";
import type { InteractionOutcomeType } from "@/generated/prisma/client";
import { logActivity } from "@/lib/activities/log-activity";
import { createTaskIfNotExists } from "@/lib/stage-engine/create-task-if-not-exists";
import { OUTCOMES, isAssetClass } from "./constants";
import { refreshCustomerIntelligence } from "./refresh";

export type RecordOutcomeInput = {
  clientId: string;
  outcome: InteractionOutcomeType;
  channel: string;
  actorType: "RM" | "CRM" | "AI_AGENT";
  actorId?: string | null;
  assetClass?: string | null;
  programme?: string | null;
  note?: string | null;
  /** RM_HANDOVER: what the AI learned, for the RM who picks the customer up. */
  summary?: string | null;
  followUpAt?: Date | null;
};

const HOUR = 60 * 60 * 1000;
const label = (value: string) => OUTCOMES.find((o) => o.value === value)?.label ?? value;

/**
 * The one place an interaction's result is recorded — whether it came from an RM, the CRM or an AI agent.
 * It logs the outcome, creates whatever follow-up it implies (a task, a handover, a service-issue flag) and refreshes
 * the customer's intelligence so acceptance, the next action and priority lists all move straight away.
 */
export async function recordInteractionOutcome(input: RecordOutcomeInput) {
  const client = await prisma.client.findFirst({
    where: { id: input.clientId, isDeleted: false, mergedIntoId: null },
    select: { id: true, name: true, assignedToId: true, assignedTo: { select: { managerId: true } } },
  });
  if (!client) throw new Error("Client not found");

  const assetClass = isAssetClass(input.assetClass) ? input.assetClass : null;
  const note = input.note?.trim().slice(0, 1000) || null;
  const summary = input.summary?.trim().slice(0, 1500) || null;

  const row = await prisma.interactionOutcome.create({
    data: { clientId: client.id, outcome: input.outcome, channel: input.channel, actorType: input.actorType, actorId: input.actorId ?? null, assetClass, programme: input.programme ?? null, note, summary, followUpAt: input.followUpAt ?? null },
  });

  await logActivity({
    clientId: client.id,
    userId: input.actorType === "RM" ? input.actorId : null,
    type: "NOTE",
    payload: {
      message: `${input.actorType === "AI_AGENT" ? "AI agent" : "Outcome"}: ${label(input.outcome)}${assetClass ? ` — ${assetClass}` : ""}${note ? ` — ${note}` : ""}`,
      outcome: input.outcome,
      channel: input.channel,
      actorType: input.actorType,
      ...(summary ? { summary } : {}),
    },
  });

  const owner = client.assignedToId ?? input.actorId ?? null;

  if (input.outcome === "FOLLOW_UP" && owner) {
    await createTaskIfNotExists({
      clientId: client.id,
      assignedToId: owner,
      title: `Follow up${assetClass ? ` on ${assetClass}` : ""}${note ? `: ${note.slice(0, 80)}` : ""}`,
      dueAt: input.followUpAt ?? new Date(Date.now() + 2 * 24 * HOUR),
      source: `outcome:${row.id}`,
    });
  }

  if (input.outcome === "RM_HANDOVER") {
    const text = summary ?? note ?? "The customer needs a person.";
    const recipients = client.assignedToId
      ? [client.assignedToId]
      : (await prisma.user.findMany({ where: { role: { in: ["MANAGER", "ADMIN"] }, isActive: true }, select: { id: true } })).map((u) => u.id);
    if (client.assignedToId) {
      await createTaskIfNotExists({ clientId: client.id, assignedToId: client.assignedToId, title: `Take over from AI: ${text.slice(0, 100)}`, dueAt: new Date(Date.now() + HOUR), source: `handover:${row.id}` });
    }
    await Promise.all(recipients.map((userId) => prisma.notification.create({ data: { userId, type: "agent_handover", payload: { clientId: client.id, clientName: client.name, summary: text.slice(0, 200) } } })));
  }

  if (input.outcome === "SERVICE_ISSUE") {
    const text = (note ?? "Customer raised a service issue.").slice(0, 300);
    await prisma.conversationInsight.create({
      data: {
        clientId: client.id,
        kind: "COMPLAINT",
        text,
        severity: "high",
        sourceType: input.actorType === "AI_AGENT" ? "CALL" : "NOTE",
        sourceRef: row.id,
        dedupeKey: createHash("sha256").update(`outcome|${row.id}`).digest("hex").slice(0, 40),
        occurredAt: new Date(),
      },
    });
    const recipients = new Set([client.assignedToId, client.assignedTo?.managerId].filter((x): x is string => !!x));
    await Promise.all([...recipients].map((userId) => prisma.notification.create({ data: { userId, type: "service_issue_open", payload: { clientId: client.id, clientName: client.name, text } } })));
  }

  await refreshCustomerIntelligence(client.id);
  return row;
}

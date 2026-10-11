import { basePrisma as db } from "@/lib/db/prisma";
import type { EventConsumer } from "@/lib/events/consumers";

import { CHECKS, classifyEventOrphan } from "./model";

/**
 * The data-health event consumer: reacts to an event the moment it is consumed (the hourly sweep is the safety net). It opens a work item for an event
 * whose customer no longer exists and was not erased. No side effects outside DataHealthItem; idempotent (one item per event); safe to replay.
 */
export const dataHealthConsumer: EventConsumer = {
  name: "data-health",
  sideEffects: "none",
  async handle(event) {
    if (!event.clientId) return;
    const exists = (await db.client.count({ where: { id: event.clientId } })) > 0;
    const erased = exists ? false : (await db.customerEvent.count({ where: { clientId: event.clientId, eventType: "customer.erased" } })) > 0;
    if (classifyEventOrphan({ clientId: event.clientId, clientExists: exists, erased }) !== "orphan") return;
    await db.dataHealthItem.upsert({
      where: { checkKey_subjectType_subjectId: { checkKey: "orphaned_event", subjectType: "event", subjectId: event.id } },
      create: { checkKey: "orphaned_event", subjectType: "event", subjectId: event.id, severity: CHECKS.orphaned_event.severity, title: CHECKS.orphaned_event.title, detail: { eventType: event.eventType } },
      update: { lastSeenAt: new Date() },
    });
  },
};

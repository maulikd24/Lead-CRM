import { buildTimelineMessage, normalizeHandoff, scrubForLog, type Handoff } from "./normalize";
import { dueFor } from "./sla";

/** Everything the hand-off flow touches, injected so it can be tested without a database. */
export type HandoffDeps = {
  now(): Date;
  /** Finds the customer by phone/email (the shared identity rule) or opens a lead. Null = could not resolve. */
  resolveClient(contact: Handoff["contact"]): Promise<{ id: string; assignedToId: string | null; name: string } | null>;
  findExisting(clientId: string, ticketId: string): Promise<{ id: string; payload: Record<string, unknown> } | null>;
  createActivity(clientId: string, payload: Record<string, unknown>, createdAt: Date): Promise<{ id: string }>;
  updateActivity(id: string, payload: Record<string, unknown>): Promise<void>;
  createTask(task: { clientId: string; assignedToId: string; title: string; dueAt: Date; source: string }): Promise<{ id: string }>;
  /** Opens a service-issue insight, which is what makes the next-best-action engine put service before sales. */
  recordServiceIssue(issue: { clientId: string; activityId: string; text: string; occurredAt: Date }): Promise<void>;
  log(message: string): void;
};

export type HandoffResult =
  | { status: "skipped"; reason: "invalid" | "not_handoff" | "no_ticket_id" | "no_contact" | "no_client" }
  | { status: "duplicate" }
  | { status: "created" | "updated"; activityId: string; taskId: string | null; serviceIssue: boolean };

export const HANDOFF_TASK_TITLE = "Follow up on support hand-off";
const CLOSED = new Set(["resolved", "closed"]);

/**
 * Turns one AI hand-off ticket event into: one timeline entry (updated in place by later events), one follow-up task
 * for the assigned RM, and, when the customer is unhappy or uses complaint or compliance wording, an open service
 * issue. Idempotent by ticket id + updated_at. Stores the capped summary only, never the transcript.
 */
export async function processHandoff(payload: unknown, deps: HandoffDeps): Promise<HandoffResult> {
  const parsed = normalizeHandoff(payload);
  if (!parsed.ok) return { status: "skipped", reason: parsed.reason };
  const h = parsed.handoff;
  const now = deps.now();

  const client = await deps.resolveClient(h.contact);
  if (!client) return { status: "skipped", reason: "no_client" };

  const updatedAt = h.updatedAt ?? now;
  const existing = await deps.findExisting(client.id, h.ticketId);
  const escalated = h.effectivePriority !== h.priority || h.escalation.negativeSentiment || h.escalation.handoverReason !== null;

  if (existing) {
    const seen = typeof existing.payload.ticketUpdatedAt === "string" ? new Date(existing.payload.ticketUpdatedAt) : null;
    if (seen && updatedAt.getTime() <= seen.getTime()) return { status: "duplicate" };
  }

  const handoffAt = existing && typeof existing.payload.handoffAt === "string" ? new Date(existing.payload.handoffAt) : now;
  const body: Record<string, unknown> = {
    source: "freshdesk",
    eventType: "ai_handoff",
    handoff: true,
    message: buildTimelineMessage(h),
    ticketId: h.ticketId,
    ...(h.ticketUrl ? { ticketUrl: h.ticketUrl } : {}),
    subject: h.subject,
    ticketStatus: h.status,
    priority: h.effectivePriority,
    ticketPriority: h.priority,
    escalated: escalated || (existing?.payload.escalated === true),
    channel: h.channel,
    intent: h.intent,
    sentiment: h.sentiment,
    summary: h.summary,
    excerpt: h.excerpt,
    ticketUpdatedAt: updatedAt.toISOString(),
    handoffAt: handoffAt.toISOString(),
    firstResponseDueAt: pickIso(existing, "firstResponseDueAt") ?? dueFor(h.effectivePriority, "firstResponse", handoffAt).toISOString(),
    resolutionDueAt: pickIso(existing, "resolutionDueAt") ?? dueFor(h.effectivePriority, "resolution", handoffAt).toISOString(),
    ...(CLOSED.has(h.status) ? { resolvedAt: pickIso(existing, "resolvedAt") ?? updatedAt.toISOString() } : {}),
  };

  let activityId: string;
  let taskId: string | null = null;
  const alreadyIssue = existing?.payload.escalated === true;

  if (existing) {
    activityId = existing.id;
    await deps.updateActivity(activityId, body);
  } else {
    activityId = (await deps.createActivity(client.id, body, handoffAt)).id;
  }

  if (!existing && client.assignedToId) {
    const task = await deps.createTask({
      clientId: client.id,
      assignedToId: client.assignedToId,
      title: HANDOFF_TASK_TITLE,
      dueAt: dueFor(h.effectivePriority, "task", handoffAt),
      source: `freshdesk-handoff:${h.ticketId}`,
    });
    taskId = task.id;
  }

  const serviceIssue = escalated && !alreadyIssue;
  if (serviceIssue) {
    const why = h.escalation.handoverReason ?? (h.escalation.negativeSentiment ? "customer sounded unhappy" : "escalated");
    await deps.recordServiceIssue({
      clientId: client.id,
      activityId,
      text: `Support hand-off needs attention (${why})${h.intent ? `: ${h.intent}` : ""}`.slice(0, 300),
      occurredAt: handoffAt,
    });
  }

  deps.log(`freshdesk hand-off ${existing ? "updated" : "created"} ticket=${scrubForLog(h.ticketId)} escalated=${escalated}`);
  return { status: existing ? "updated" : "created", activityId, taskId, serviceIssue };
}

function pickIso(existing: { payload: Record<string, unknown> } | null, key: string): string | null {
  const v = existing?.payload[key];
  return typeof v === "string" ? v : null;
}

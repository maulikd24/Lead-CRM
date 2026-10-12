import { createHash } from "node:crypto";

/**
 * Handover bookkeeping, model-free and idempotent: used by the reply assistant and by the (flag-guarded) ingest hook.
 * It leaves a compliance trace the nudger already respects (an OPEN COMPLAINT insight), a task, an activity entry and
 * notifications. Deliberately does NOT refresh intelligence or fire journey triggers (unlike recordInteractionOutcome).
 */
export const HANDOVER_TASK_PREFIX = "wa_handover:";

export type HandoverClient = { id: string; name: string; assignedToId: string | null; managerId: string | null };

export type HandoverDeps = {
  /** An unresolved handover marker created since the RM's last outbound message, if any. */
  findOpenHandover: (clientId: string) => Promise<{ id: string } | null>;
  createMarker: (clientId: string, reason: string, now: Date) => Promise<{ id: string }>;
  loadClient: (clientId: string) => Promise<HandoverClient | null>;
  createInsight: (i: { clientId: string; dedupeKey: string; text: string; occurredAt: Date; sourceRef: string }) => Promise<"created" | "exists">;
  createTask: (t: { clientId: string; assignedToId: string; title: string; dueAt: Date; source: string }) => Promise<void>;
  logActivity: (a: { clientId: string; message: string }) => Promise<void>;
  notify: (userId: string, type: string, payload: Record<string, string>) => Promise<void>;
  /** Managers and admins, used when the customer has no assigned RM. */
  fallbackRecipients: () => Promise<string[]>;
  now: () => Date;
};

export async function recordHandover(deps: HandoverDeps, input: { clientId: string; triggerMessageId: string; reason: string }): Promise<{ proposalId: string; created: boolean }> {
  const open = await deps.findOpenHandover(input.clientId);
  if (open) return { proposalId: open.id, created: false };
  const client = await deps.loadClient(input.clientId);
  if (!client) return { proposalId: "", created: false };

  const now = deps.now();
  const marker = await deps.createMarker(client.id, input.reason, now);
  const text = "Customer message flagged for human handling (complaint, regulator or fraud wording). No AI reply was drafted.";
  await deps.createInsight({
    clientId: client.id,
    dedupeKey: createHash("sha256").update(`wa_handover|${client.id}|${input.triggerMessageId}`).digest("hex").slice(0, 40),
    text,
    occurredAt: now,
    sourceRef: input.triggerMessageId,
  });
  if (client.assignedToId) {
    await deps.createTask({ clientId: client.id, assignedToId: client.assignedToId, title: "Reply personally: customer raised a complaint, regulator or fraud topic", dueAt: new Date(now.getTime() + 60 * 60 * 1000), source: `${HANDOVER_TASK_PREFIX}${client.id}` });
  }
  await deps.logActivity({ clientId: client.id, message: "Customer message flagged for human handling" });
  const recipients = new Set(client.assignedToId ? [client.assignedToId, ...(client.managerId ? [client.managerId] : [])] : await deps.fallbackRecipients());
  await Promise.all([...recipients].map((userId) => deps.notify(userId, "agent_handover", { clientId: client.id, clientName: client.name, summary: text.slice(0, 200) })));
  return { proposalId: marker.id, created: true };
}

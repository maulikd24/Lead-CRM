import type { SimAction, SimChannel, SimResult } from "./engine";

/** First use of simulate(): bulk follow-up task creation on the customer list. Pure planning; the server action (clients/simulate-actions.ts) loads facts and writes. */

export const MAX_BULK_TASKS = 200;
const CHANNELS = ["call", "whatsapp", "email", "any"] as const;
export type BulkFollowUpParams = { title: string; channel: (typeof CHANNELS)[number]; kind: "service" | "sales"; dueInDays: number };

export function validateBulkParams(p: BulkFollowUpParams): { ok: true; params: BulkFollowUpParams } | { ok: false; error: string } {
  const title = typeof p?.title === "string" ? p.title.trim() : "";
  if (title.length === 0 || title.length > 120) return { ok: false, error: "Give the task a title of up to 120 characters." };
  if (!(CHANNELS as readonly string[]).includes(p.channel)) return { ok: false, error: "Choose a channel." };
  if (p.kind !== "service" && p.kind !== "sales") return { ok: false, error: "Choose service or sales." };
  if (!Number.isInteger(p.dueInDays) || p.dueInDays < 1 || p.dueInDays > 90) return { ok: false, error: "Due date must be 1 to 90 days from now." };
  return { ok: true, params: { ...p, title } };
}

/** The SimAction for this request. A service follow-up falls under SERVICE_COMMS, a sales one under MARKETING_COMMS (needs opt-in). No AI is used. */
export function bulkFollowUpAction(p: BulkFollowUpParams): SimAction {
  const channels: SimChannel[] = p.channel === "any" ? ["call", "whatsapp", "email"] : [p.channel];
  return {
    id: "bulk-follow-up",
    purpose: p.kind === "sales" ? "MARKETING_COMMS" : "SERVICE_COMMS",
    kind: p.kind,
    channels,
    recentContactHours: 48,
    frequencyCap: { maxContacts: 3, windowDays: 14 },
    aiCallsPerTarget: 0,
  };
}

export type PlannedTask = { clientId: string; assignedToId: string; title: string; dueAt: Date; category: "FOLLOW_UP"; source: "bulk-follow-up" };

/** One task per ELIGIBLE customer, assigned to that customer's RM (or to the person creating the batch), capped per batch. Suppressed customers get nothing. */
export function planBulkTasks(sim: Pick<SimResult, "eligible">, ownerByClient: ReadonlyMap<string, string | null>, p: BulkFollowUpParams, now: Date, creatorId: string): PlannedTask[] {
  return sim.eligible.slice(0, MAX_BULK_TASKS).map((e) => ({
    clientId: e.id,
    assignedToId: ownerByClient.get(e.id) ?? creatorId,
    title: `${p.title} (${e.channel})`,
    dueAt: new Date(now.getTime() + p.dueInDays * 86_400_000),
    category: "FOLLOW_UP" as const,
    source: "bulk-follow-up" as const,
  }));
}

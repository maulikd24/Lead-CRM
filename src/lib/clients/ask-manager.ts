import { needsManagerReview } from "./merge-policy";

/**
 * "Ask a manager to review": an RM who sees a possible duplicate that spans another RM's customer, or an unassigned one, cannot
 * merge it (see merge-policy.ts). This hands it to a manager as an in-app Notification (no new table). The notification carries
 * ids and the RM's own customer's code only: nothing about the other customer (name, mobile, email) is ever copied into it, and
 * the RM never learns who owns the other customer.
 */
export type AskCode = "FORBIDDEN" | "INVALID" | "RATE_LIMITED" | "NOT_FOUND" | "STALE" | "NOT_NEEDED" | "NO_MANAGER";
export type AskResult = { ok: true; notified: number; alreadyAsked?: true } | { ok: false; code: AskCode; error: string };

export type AskPayload = { suggestionId: string; clientId: string; clientCode: string; requestedById: string; rmName: string };

export type AskDeps = {
  allowRate: (actorId: string) => Promise<boolean>;
  loadSuggestion: (id: string) => Promise<{ id: string; status: string; clientAId: string; clientBId: string } | null>;
  loadClients: (ids: string[]) => Promise<{ id: string; clientCode: string; assignedToId: string | null; isDeleted: boolean; mergedIntoId: string | null }[]>;
  /** The RM's own manager; else every active manager; else every active admin. */
  recipientsFor: (actorId: string) => Promise<string[]>;
  alreadyAsked: (actorId: string, suggestionId: string) => Promise<boolean>;
  notify: (userIds: string[], payload: AskPayload) => Promise<void>;
};

const fail = (code: AskCode, error: string): AskResult => ({ ok: false, code, error });
const NOT_FOUND = "That possible duplicate could not be found.";

export async function askManagerToReview(deps: AskDeps, actor: { id: string; role: string; name: string }, suggestionId: unknown): Promise<AskResult> {
  if (actor.role !== "RM") return fail("FORBIDDEN", "Only a relationship manager can ask a manager to review a duplicate. Managers and admins can review it directly.");
  if (typeof suggestionId !== "string" || !suggestionId || suggestionId.length > 64) return fail("INVALID", NOT_FOUND);
  if (!(await deps.allowRate(actor.id))) return fail("RATE_LIMITED", "You are doing that too quickly. Wait a moment and try again.");

  const s = await deps.loadSuggestion(suggestionId);
  if (!s) return fail("NOT_FOUND", NOT_FOUND);
  const clients = await deps.loadClients([s.clientAId, s.clientBId]);
  const own = clients.find((c) => c.assignedToId === actor.id);
  // A pair the RM has no customer in is answered exactly like a missing one: this cannot be used to probe other RMs' customers.
  if (!own) return fail("NOT_FOUND", NOT_FOUND);
  if (s.status !== "OPEN" || clients.length !== 2 || clients.some((c) => c.isDeleted || c.mergedIntoId)) return fail("STALE", "This possible duplicate was already decided, merged or removed.");
  if (!needsManagerReview(actor, clients)) return fail("NOT_NEEDED", "Both customers are yours, so you can merge them yourself from the customer page.");

  if (await deps.alreadyAsked(actor.id, s.id)) return { ok: true, notified: 0, alreadyAsked: true };
  const recipients = [...new Set(await deps.recipientsFor(actor.id))];
  if (recipients.length === 0) return fail("NO_MANAGER", "There is no manager to ask. Please tell an administrator.");
  await deps.notify(recipients, { suggestionId: s.id, clientId: own.id, clientCode: own.clientCode, requestedById: actor.id, rmName: actor.name });
  return { ok: true, notified: recipients.length };
}

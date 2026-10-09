import type { Role } from "@/generated/prisma/client";
import { MergeBlockedError, type MergeSummary } from "@/lib/clients/merge";

export type Actor = { id: string; role: Role };
export type DecideCode = "FORBIDDEN" | "INVALID" | "RATE_LIMITED" | "NOT_FOUND" | "STALE" | "OUT_OF_SCOPE" | "BLOCKED" | "ERROR";
export type Failure = { ok: false; code: DecideCode; error: string };

export type DecideDeps = {
  /** null = unrestricted (admin). */
  visibleUserIds: (actor: Actor) => Promise<string[] | null>;
  loadSuggestion: (id: string) => Promise<{ id: string; status: string; clientAId: string; clientBId: string } | null>;
  /** Only customers that are still live (not archived, not merged). A missing id means "no longer live". */
  loadClientScopes: (ids: string[]) => Promise<{ id: string; assignedToId: string | null }[]>;
  allowRate: (actorId: string) => Promise<boolean>;
  /** Runs in ONE transaction: compare-and-set the suggestion, merge, close superseded suggestions, audit. Throws MergeBlockedError when stale/blocked. */
  merge: (args: { suggestionId: string; survivorId: string; duplicateId: string; actorId: string }) => Promise<MergeSummary>;
  /** Compare-and-set OPEN -> DISMISSED. Resolves false when someone else already decided it. */
  dismiss: (args: { suggestionId: string; actorId: string; reason: string | null }) => Promise<boolean>;
};

export const MAX_REASON = 300;
const fail = (code: DecideCode, error: string): Failure => ({ ok: false, code, error });
const ALLOWED: Role[] = ["ADMIN", "MANAGER"];

/** Same visibility rule the client page applies: admins see all, others only their scope; managers also own the unassigned pool. */
export function inScope(visible: string[] | null, role: Role, assignedToId: string | null): boolean {
  if (visible === null) return true;
  if (!assignedToId) return role === "MANAGER";
  return visible.includes(assignedToId);
}

const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

async function guard(deps: DecideDeps, actor: Actor, suggestionId: unknown) {
  if (!ALLOWED.includes(actor.role)) return fail("FORBIDDEN", "Only an Admin or Manager can review duplicate customers.");
  if (!isId(suggestionId)) return fail("INVALID", "That suggestion could not be found.");
  if (!(await deps.allowRate(actor.id))) return fail("RATE_LIMITED", "You are doing that too quickly. Wait a moment and try again.");
  const s = await deps.loadSuggestion(suggestionId);
  if (!s) return fail("NOT_FOUND", "That suggestion no longer exists.");
  if (s.status !== "OPEN") return fail("STALE", "Someone has already decided this suggestion.");
  const scopes = await deps.loadClientScopes([s.clientAId, s.clientBId]);
  if (scopes.length !== 2) return fail("STALE", "One of these customers was already merged, archived or removed.");
  const visible = await deps.visibleUserIds(actor);
  if (!scopes.every((c) => inScope(visible, actor.role, c.assignedToId))) return fail("OUT_OF_SCOPE", "You do not have access to both of these customers.");
  return { suggestion: s };
}

export async function decideMerge(
  deps: DecideDeps,
  actor: Actor,
  input: { suggestionId: unknown; survivorId: unknown; confirmed: unknown },
): Promise<({ ok: true; survivorId: string; duplicateId: string; summary: MergeSummary }) | Failure> {
  if (!ALLOWED.includes(actor.role)) return fail("FORBIDDEN", "Only an Admin or Manager can review duplicate customers.");
  if (input.confirmed !== true) return fail("INVALID", "Please confirm that you understand this merge cannot be undone.");
  if (!isId(input.survivorId)) return fail("INVALID", "Choose which customer to keep.");
  const g = await guard(deps, actor, input.suggestionId);
  if ("ok" in g) return g;
  const { suggestion } = g;
  if (input.survivorId !== suggestion.clientAId && input.survivorId !== suggestion.clientBId) return fail("INVALID", "The customer to keep must be one of the two in this suggestion.");
  const duplicateId = input.survivorId === suggestion.clientAId ? suggestion.clientBId : suggestion.clientAId;
  try {
    const summary = await deps.merge({ suggestionId: suggestion.id, survivorId: input.survivorId, duplicateId, actorId: actor.id });
    return { ok: true, survivorId: input.survivorId, duplicateId, summary };
  } catch (error) {
    if (error instanceof MergeBlockedError) return fail(error.code === "STALE" ? "STALE" : "BLOCKED", error.message);
    console.error("Merge suggestion failed", error instanceof Error ? error.name : "unknown");
    return fail("ERROR", "The merge could not be completed and nothing was changed. Please try again.");
  }
}

export async function decideDismiss(
  deps: DecideDeps,
  actor: Actor,
  input: { suggestionId: unknown; reason?: unknown },
): Promise<{ ok: true } | Failure> {
  if (!ALLOWED.includes(actor.role)) return fail("FORBIDDEN", "Only an Admin or Manager can review duplicate customers.");
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length > MAX_REASON) return fail("INVALID", `Keep the reason under ${MAX_REASON} characters.`);
  const g = await guard(deps, actor, input.suggestionId);
  if ("ok" in g) return g;
  try {
    const won = await deps.dismiss({ suggestionId: g.suggestion.id, actorId: actor.id, reason: reason || null });
    return won ? { ok: true } : fail("STALE", "Someone has already decided this suggestion.");
  } catch (error) {
    console.error("Dismiss suggestion failed", error instanceof Error ? error.name : "unknown");
    return fail("ERROR", "That could not be saved. Please try again.");
  }
}

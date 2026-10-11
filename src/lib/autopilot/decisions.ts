import { applyRefusal, type GuardedProvider } from "./actions";
import { decide, type Decision, type Recommendation } from "./recommendations";

/**
 * The legacy decision path for an Autopilot proposal, with its database and ad-account access injected so it is tested without either. The canonical
 * approval service (lib/policy/approvals/canonical) reaches proposals ONLY through the adapter, which calls decideRecommendation; the apply step is a second,
 * explicit human act (applyApproved) that can run only on a proposal a person approved. Autonomy: L4 at most. Nothing here applies on its own.
 */
export type EventKind = "approved" | "denied" | "applied" | "apply_failed";
export type DecisionEvent = { recId: string; correlationId: string; actorUserId: string; reasonCode?: string | null; errorClass?: string };

export type DecisionDeps = {
  getRec: (id: string) => Promise<Recommendation | null>;
  /** Compare-and-set PENDING to APPROVED or DENIED, with the decision and its audit row in one transaction. false: someone else decided first. */
  recordDecision: (d: Decision & { correlationId?: string | null }) => Promise<boolean>;
  /** Compare-and-set APPROVED to APPLYING. true: this caller, and only this caller, may now call the ad account. */
  claimApply: (id: string) => Promise<boolean>;
  markApplied: (id: string, userId: string, res: { ok: boolean; undoToken?: string | null; error?: string }) => Promise<void>;
  provider: GuardedProvider;
  /** Best effort: an event that cannot be stored never changes the outcome. */
  emit: (kind: EventKind, e: DecisionEvent) => Promise<void>;
};

export type DecisionOutcome = { ok: true } | { ok: false; error: string };
const safeEmit = async (deps: DecisionDeps, kind: EventKind, e: DecisionEvent) => { try { await deps.emit(kind, e); } catch { /* an event is never the decision's problem */ } };

export async function decideRecommendation(
  deps: DecisionDeps,
  input: { recId: string; verdict: "approve" | "deny"; actorId: string; reasonCode?: string; note?: string },
): Promise<DecisionOutcome> {
  const rec = await deps.getRec(input.recId);
  if (!rec) return { ok: false, error: "That proposal no longer exists." };
  const d = decide(rec, input.verdict, input.actorId, { reasonCode: input.reasonCode, note: input.note });
  if (!d.ok) return d;
  if (!(await deps.recordDecision({ ...d.decision, correlationId: rec.correlationId ?? null }))) return { ok: false, error: "This proposal has already been decided." };
  if (rec.correlationId) await safeEmit(deps, d.decision.decision === "APPROVED" ? "approved" : "denied", { recId: rec.id, correlationId: rec.correlationId, actorUserId: input.actorId, reasonCode: d.decision.reasonCode });
  return { ok: true };
}

export async function applyApproved(deps: DecisionDeps, input: { recId: string; actorId: string }): Promise<DecisionOutcome> {
  const rec = await deps.getRec(input.recId);
  if (!rec) return { ok: false, error: "That proposal no longer exists." };
  // Refusals that leave the proposal exactly as it was (still approved): off, not approved, not appliable, a budget change that is not a small cut.
  if (!deps.provider.applyEnabled) return { ok: false, error: "Applying changes to ad accounts is switched off." };
  const refusal = applyRefusal(rec, input.actorId || null);
  if (refusal) return { ok: false, error: refusal };
  if (!(await deps.claimApply(rec.id))) return { ok: false, error: "This proposal is already being applied or was applied." };
  let res;
  try { res = await deps.provider.apply(rec, input.actorId); } catch { res = { ok: false as const, error: "The ad platform could not be reached." }; }
  await deps.markApplied(rec.id, input.actorId, res);
  if (rec.correlationId) await safeEmit(deps, res.ok ? "applied" : "apply_failed", { recId: rec.id, correlationId: rec.correlationId, actorUserId: input.actorId, ...(res.ok ? {} : { errorClass: "provider_refused" }) });
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

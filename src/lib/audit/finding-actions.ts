/**
 * Actions on audit findings: acknowledge, resolve, dismiss. Each write records the actor and the time in the audit log.
 *
 * Who may act (follows the access policy, area "quality-audit"):
 * - ADMIN and MANAGER: every action on any finding.
 * - RM: acknowledge only, and only a finding whose customer is assigned to that RM. Never resolve or dismiss.
 * - Every other role: nothing.
 *
 * Transitions: acknowledge OPEN -> ACKNOWLEDGED; resolve OPEN or ACKNOWLEDGED -> RESOLVED; dismiss OPEN or ACKNOWLEDGED -> DISMISSED.
 * RESOLVED and DISMISSED are final. The port applies the change and its audit row in one transaction, guarded by the status
 * it expects, so two people acting at once cannot both win.
 *
 * Pure: the storage is behind FindingActionPort. The Prisma adapter is in finding-actions-prisma.ts.
 */
import type { Role } from "@/generated/prisma/client";

export type FindingDbStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED";
export type FindingActionKind = "acknowledge" | "resolve" | "dismiss";
export const FINDING_ACTION_KINDS: readonly FindingActionKind[] = ["acknowledge", "resolve", "dismiss"];

export type FindingActor = { userId: string; role: Role };

export type FindingForAction = {
  id: string;
  status: FindingDbStatus;
  clientId: string | null;
  /** The RM the customer is assigned to, or null. Used only for the RM's own-customers rule. */
  clientAssignedToId: string | null;
};

export type FindingActionPort = {
  load(findingId: string): Promise<FindingForAction | null>;
  /** Applies the change and the audit row together. Returns false when the finding was not in one of `from` (someone else acted first). */
  apply(input: {
    findingId: string;
    from: readonly FindingDbStatus[];
    fromStatus: FindingDbStatus;
    to: FindingDbStatus;
    actorId: string;
    at: Date;
    action: FindingActionKind;
    note: string | null;
  }): Promise<boolean>;
};

export const TRANSITIONS: Record<FindingActionKind, { from: readonly FindingDbStatus[]; to: FindingDbStatus }> = {
  acknowledge: { from: ["OPEN"], to: "ACKNOWLEDGED" },
  resolve: { from: ["OPEN", "ACKNOWLEDGED"], to: "RESOLVED" },
  dismiss: { from: ["OPEN", "ACKNOWLEDGED"], to: "DISMISSED" },
};

export const NOTE_MAX_CHARS = 300;

export type ActionResult =
  | { ok: true; status: FindingDbStatus }
  | { ok: false; code: "FORBIDDEN" | "NOT_FOUND" | "BAD_STATE" | "INVALID"; message: string };

/** The role rule, on its own so the policy can be read in one place. */
export function mayAct(actor: FindingActor, finding: FindingForAction, action: FindingActionKind): boolean {
  if (actor.role === "ADMIN" || actor.role === "MANAGER") return true;
  if (actor.role === "RM") {
    return action === "acknowledge" && finding.clientId !== null && finding.clientAssignedToId === actor.userId;
  }
  return false;
}

export async function actOnFinding(
  port: FindingActionPort,
  input: { findingId: string; action: FindingActionKind; actor: FindingActor; note?: string | null; now: Date },
): Promise<ActionResult> {
  if (!FINDING_ACTION_KINDS.includes(input.action)) return { ok: false, code: "INVALID", message: "Unknown action." };
  const note = typeof input.note === "string" ? input.note.trim().slice(0, NOTE_MAX_CHARS) || null : null;
  const finding = await port.load(input.findingId);
  if (!finding) return { ok: false, code: "NOT_FOUND", message: "Not found." };
  if (!mayAct(input.actor, finding, input.action)) return { ok: false, code: "FORBIDDEN", message: "Not allowed." };

  const t = TRANSITIONS[input.action];
  if (!t.from.includes(finding.status)) return { ok: false, code: "BAD_STATE", message: "This finding is already past that step." };
  const applied = await port.apply({
    findingId: finding.id,
    from: t.from,
    fromStatus: finding.status,
    to: t.to,
    actorId: input.actor.userId,
    at: input.now,
    action: input.action,
    note,
  });
  if (!applied) return { ok: false, code: "BAD_STATE", message: "Someone else changed this finding. Refresh and try again." };
  return { ok: true, status: t.to };
}

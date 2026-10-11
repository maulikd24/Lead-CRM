import type { Prisma } from "@/generated/prisma/client";

import { definitionOf, isKind } from "./definitions";
import type { ApprovalKind } from "./contract";
import type { MirrorRecord } from "./service";

/**
 * Write-through: with an adapter's switch on, a decision made through the canonical service also leaves ONE canonical record on the
 * existing generic ApprovalRequest table: who decided, when, why, the correlation chain and the autonomy level. The legacy row stays
 * authoritative and is never changed by this. The record is born decided (never PENDING), so no existing queue lists it and
 * `decideApproval` refuses it. Its idempotency key makes a repeat a no-op.
 *
 * ApprovalRequest.requestedById is required, so for a request made by a job or an agent the decider is recorded there and
 * payload.requester says "system". The legacy row, not this one, is the source for who really asked.
 */
type Db = { approvalRequest: { create: (args: { data: Prisma.ApprovalRequestUncheckedCreateInput }) => Promise<unknown> } };

const STATUS = { rejected: "REJECTED", expired: "EXPIRED", cancelled: "CANCELLED" } as const;

export function mirrorData(r: MirrorRecord): Prisma.ApprovalRequestUncheckedCreateInput {
  const status = STATUS[r.state as keyof typeof STATUS] ?? "APPROVED";
  return {
    actionType: r.kind.toUpperCase().replace(/-/g, "_"),
    entity: r.subject.type,
    entityId: r.subject.id,
    status,
    payload: { mirror: true, kind: r.kind, subjectId: r.id, state: r.state, decision: r.decision, requester: r.requesterId ?? "system" },
    reason: null,
    requestedById: r.requesterId ?? r.actorId,
    decidedById: r.actorId,
    decidedAt: r.decidedAt,
    decisionNote: r.reason,
    appliedAt: r.state === "executed" ? r.decidedAt : null,
    correlationId: r.correlationId,
    causationId: r.causationId,
    autonomyLevel: r.autonomy,
    idempotencyKey: `mirror:${r.kind}:${r.id}:${r.state}`,
  };
}

export async function writeMirror(db: Db, r: MirrorRecord): Promise<void> {
  try {
    await db.approvalRequest.create({ data: mirrorData(r) });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return; // already recorded
    throw error;
  }
}

/** One switch per adapter over a foreign table; native and seam kinds have none. */
export function writeThroughEnabled(kind: ApprovalKind | string, env: Record<string, string | undefined> = process.env): boolean {
  if (!isKind(kind)) return false;
  const flag = definitionOf(kind).writeThroughFlag;
  return !!flag && env[flag] === "1";
}

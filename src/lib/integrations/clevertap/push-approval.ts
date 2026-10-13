import { createHash } from "node:crypto";

/**
 * Human approval for a CleverTap push batch. The batch is the set of customers selected for one tick plus its region. It is
 * identified by a hash of (region, sorted client ids); an ApprovalRequest with actionType CLEVERTAP_PUSH_BATCH and entityId = that
 * hash must be APPROVED (and unexpired) before anything is sent. Everything else refuses: no request, pending, rejected, expired
 * or a payload that does not match. Only counts and the decision reason are ever logged, never ids or signals.
 */
export const CLEVERTAP_BATCH_ACTION = "CLEVERTAP_PUSH_BATCH";
export const CLEVERTAP_BATCH_ENTITY = "CleverTapPushBatch";

export type BatchRef = { hash: string; count: number; region: string };

export function batchRef(region: string, clientIds: string[]): BatchRef {
  const ids = [...clientIds].sort();
  const hash = createHash("sha256").update(JSON.stringify({ region, ids })).digest("hex");
  return { hash, count: ids.length, region };
}

type ApprovalRow = { id: string; status: string; payload: unknown; expiresAt: Date | null };

/** The slice of the Prisma client this gate reads. Read-only: the gate never writes. */
export type BatchApprovalDb = {
  approvalRequest: {
    findMany: (args: {
      where: { actionType: string; entity: string; entityId: string };
      orderBy: { requestedAt: "desc" };
      take: number;
      select: { id: true; status: true; payload: true; expiresAt: true };
    }) => Promise<ApprovalRow[]>;
  };
};

export type BatchGateReason = "no_approval" | "pending" | "rejected" | "expired" | "mismatch";
export type BatchGate = { allowed: true; requestId: string } | { allowed: false; reason: BatchGateReason };

export async function checkBatchApproval(db: BatchApprovalDb, ref: BatchRef, now: Date = new Date()): Promise<BatchGate> {
  const rows = await db.approvalRequest.findMany({
    where: { actionType: CLEVERTAP_BATCH_ACTION, entity: CLEVERTAP_BATCH_ENTITY, entityId: ref.hash },
    orderBy: { requestedAt: "desc" },
    take: 5,
    select: { id: true, status: true, payload: true, expiresAt: true },
  });
  const approved = rows.find((r) => r.status === "APPROVED");
  if (!approved) {
    const latest = rows[0];
    if (latest?.status === "PENDING") return { allowed: false, reason: "pending" };
    if (latest?.status === "REJECTED") return { allowed: false, reason: "rejected" };
    return { allowed: false, reason: "no_approval" };
  }
  if (approved.expiresAt && approved.expiresAt.getTime() <= now.getTime()) return { allowed: false, reason: "expired" };
  const payload = (approved.payload ?? {}) as { region?: unknown; count?: unknown };
  if (payload.region !== ref.region || payload.count !== ref.count) return { allowed: false, reason: "mismatch" };
  return { allowed: true, requestId: approved.id };
}

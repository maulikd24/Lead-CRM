import { createHash } from "node:crypto";

import { batchState, type BatchPayload } from "./batch-preview";

/**
 * Human approval for a CleverTap push batch. An Admin requests a batch: the customers selected at that moment and their region are
 * frozen into the ApprovalRequest payload (CLEVERTAP_PUSH_BATCH, entity CleverTapPushBatch). A different Admin approves it. The push
 * tick then sends exactly that list, once: it claims the approved request (ready -> sent) before the first send, so a second tick
 * finds it used. A tick never selects a fresh batch against an old approval. Only counts and the decision reason are ever logged.
 */
export const CLEVERTAP_BATCH_ACTION = "CLEVERTAP_PUSH_BATCH";
export const CLEVERTAP_BATCH_ENTITY = "CleverTapPushBatch";

/** entityId for the request: a hash of the region and the sorted client ids, so the same batch is never requested twice as two rows. */
export function batchHash(region: string, clientIds: string[]): string {
  const ids = [...clientIds].sort();
  return createHash("sha256").update(JSON.stringify({ region, ids })).digest("hex");
}

export function batchPayload(region: string, clientIds: string[]): BatchPayload {
  return { region, count: clientIds.length, clientIds: [...clientIds], state: "ready" };
}

type ApprovalRow = { id: string; status: string; payload: unknown; expiresAt: Date | null };

/** The slice of the Prisma client this gate reads and claims. */
export type BatchApprovalDb = {
  approvalRequest: {
    findMany: (args: {
      where: { actionType: string; entity: string };
      orderBy: { requestedAt: "desc" };
      take: number;
      select: { id: true; status: true; payload: true; expiresAt: true };
    }) => Promise<ApprovalRow[]>;
    updateMany: (args: {
      where: { id: string; status: "APPROVED"; payload: { path: string[]; equals: string } };
      data: { payload: unknown };
    }) => Promise<{ count: number }>;
  };
};

export type BatchGateReason = "no_approval" | "pending" | "rejected" | "expired" | "used" | "mismatch";
export type BatchGate = { allowed: true; requestId: string; clientIds: string[] } | { allowed: false; reason: BatchGateReason };

const SELECT = { id: true, status: true, payload: true, expiresAt: true } as const;

function isLive(row: ApprovalRow, now: Date): boolean {
  return row.status === "APPROVED" && batchState(row.payload) === "ready" && !(row.expiresAt && row.expiresAt.getTime() <= now.getTime());
}

/** Lists the recent batch requests, newest first. */
export async function recentBatchRequests(db: BatchApprovalDb, take = 10): Promise<ApprovalRow[]> {
  return db.approvalRequest.findMany({ where: { actionType: CLEVERTAP_BATCH_ACTION, entity: CLEVERTAP_BATCH_ENTITY }, orderBy: { requestedAt: "desc" }, take, select: SELECT });
}

/**
 * Finds the approved, unused batch for this region and claims it. Returns the frozen client ids on success. The claim is a
 * conditional update (still APPROVED and state "ready"), so two overlapping ticks cannot both send the same batch.
 */
export async function claimApprovedBatch(db: BatchApprovalDb, region: string, now: Date = new Date()): Promise<BatchGate> {
  const rows = await recentBatchRequests(db);
  const ready = rows.find((r) => r.status === "APPROVED" && batchState(r.payload) === "ready");
  if (!ready) {
    const latest = rows[0];
    if (latest?.status === "PENDING") return { allowed: false, reason: "pending" };
    if (latest?.status === "REJECTED") return { allowed: false, reason: "rejected" };
    if (latest?.status === "APPROVED") return { allowed: false, reason: "used" };
    return { allowed: false, reason: "no_approval" };
  }
  if (ready.expiresAt && ready.expiresAt.getTime() <= now.getTime()) return { allowed: false, reason: "expired" };

  const payload = (ready.payload ?? {}) as Partial<BatchPayload>;
  if (payload.region !== region || !Array.isArray(payload.clientIds) || payload.clientIds.some((x) => typeof x !== "string")) {
    return { allowed: false, reason: "mismatch" };
  }
  const clientIds = payload.clientIds as string[];

  const claimed = await db.approvalRequest.updateMany({
    where: { id: ready.id, status: "APPROVED", payload: { path: ["state"], equals: "ready" } },
    data: { payload: { ...payload, state: "sent", sentAt: now.toISOString() } },
  });
  if (claimed.count === 0) return { allowed: false, reason: "used" };
  return { allowed: true, requestId: ready.id, clientIds };
}

/** True when a batch is waiting for a decision or approved and still unsent. A new request is refused while this holds. */
export function hasOpenBatch(rows: ApprovalRow[], now: Date = new Date()): boolean {
  return rows.some((r) => r.status === "PENDING" || isLive(r, now));
}

/**
 * The frozen CleverTap batch as stored in ApprovalRequest.payload. Pure (no node imports) so the approvals screen can read it too.
 * clientIds is the exact list the approval covers. state moves once from "ready" to "sent", when the push tick claims it.
 */
export type BatchPayload = { region: string; count: number; clientIds: string[]; state: "ready" | "sent"; sentAt?: string };

/** The most customers one batch can hold (the request limit). The approver sees every id, so the whole batch can be checked. */
export const PREVIEW_MAX_IDS = 25;

export function batchState(payload: unknown): unknown {
  return payload && typeof payload === "object" ? (payload as { state?: unknown }).state : undefined;
}

/**
 * What the approver sees: region, count, every client id in the batch, and the batch hash (the request's entityId, the same value the
 * push checks before it sends). Ids only: never names, emails, phone numbers or signals.
 */
export function batchPreview(payload: unknown, hash?: string | null): { region: string; count: number; ids: string[]; hash: string | null } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { region?: unknown; clientIds?: unknown };
  if (typeof p.region !== "string" || !Array.isArray(p.clientIds)) return null;
  const ids = p.clientIds.filter((x): x is string => typeof x === "string");
  return { region: p.region, count: ids.length, ids, hash: hash ?? null };
}

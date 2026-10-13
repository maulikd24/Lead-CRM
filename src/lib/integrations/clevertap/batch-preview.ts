/**
 * The frozen CleverTap batch as stored in ApprovalRequest.payload. Pure (no node imports) so the approvals screen can read it too.
 * clientIds is the exact list the approval covers. state moves once from "ready" to "sent", when the push tick claims it.
 */
export type BatchPayload = { region: string; count: number; clientIds: string[]; state: "ready" | "sent"; sentAt?: string };

export const PREVIEW_IDS = 5;

export function batchState(payload: unknown): unknown {
  return payload && typeof payload === "object" ? (payload as { state?: unknown }).state : undefined;
}

/** Region, count and the first few client ids only. Never names, emails or signals. */
export function batchPreview(payload: unknown): { region: string; count: number; preview: string[]; more: number } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { region?: unknown; clientIds?: unknown };
  if (typeof p.region !== "string" || !Array.isArray(p.clientIds)) return null;
  const ids = p.clientIds.filter((x): x is string => typeof x === "string");
  return { region: p.region, count: ids.length, preview: ids.slice(0, PREVIEW_IDS), more: Math.max(0, ids.length - PREVIEW_IDS) };
}

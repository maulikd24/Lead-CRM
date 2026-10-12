import { z } from "zod";

const INVALID = { ok: false, error: "Invalid request" } as const;
const id = z.string().min(1).max(100);
const body = z.string().max(1000).optional();

export type ApproveInput = { ok: true; proposalId: string; editedBody: string | undefined } | typeof INVALID;
export type RejectInput = { ok: true; proposalId: string } | typeof INVALID;

export function parseApproveInput(proposalId: unknown, editedBody: unknown): ApproveInput {
  const r = z.object({ proposalId: id, editedBody: body }).safeParse({ proposalId, editedBody });
  return r.success ? { ok: true, proposalId: r.data.proposalId, editedBody: r.data.editedBody } : INVALID;
}

export function parseRejectInput(proposalId: unknown): RejectInput {
  const r = id.safeParse(proposalId);
  return r.success ? { ok: true, proposalId: r.data } : INVALID;
}

"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-role";
import { approveProposal, rejectProposal } from "@/lib/agents/decide";
import { parseApproveInput, parseRejectInput } from "@/lib/agents/action-input";
import { decideDeps } from "@/lib/agents/wiring";

export async function approveAction(proposalId: unknown, editedBody?: unknown) {
  const session = await requireUser();
  const input = parseApproveInput(proposalId, editedBody);
  if (!input.ok) return input;
  const res = await approveProposal(decideDeps(), { proposalId: input.proposalId, user: { id: session.user.id, role: session.user.role }, editedBody: input.editedBody });
  revalidatePath("/agents");
  return res;
}

export async function rejectAction(proposalId: unknown) {
  const session = await requireUser();
  const input = parseRejectInput(proposalId);
  if (!input.ok) return input;
  const res = await rejectProposal(decideDeps(), { proposalId: input.proposalId, user: { id: session.user.id, role: session.user.role } });
  revalidatePath("/agents");
  return res;
}

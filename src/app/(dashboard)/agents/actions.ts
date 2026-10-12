"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { requireRole, requireUser } from "@/lib/auth/require-role";
import { parseSetEnabledInput } from "@/lib/agents/rules";
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

/** Kill switch: Admins only. Switching on has no effect unless the agent's environment flag is also on (see `agentEnabled`). */
export async function setAgentEnabledAction(agentKey: unknown, enabled: unknown) {
  const session = await requireRole(["ADMIN"]);
  const input = parseSetEnabledInput(agentKey, enabled);
  if (!input.ok) return input;
  await prisma.agentSetting.upsert({
    where: { agentKey: input.agentKey },
    create: { agentKey: input.agentKey, enabled: input.enabled, updatedById: session.user.id },
    update: { enabled: input.enabled, updatedById: session.user.id },
  });
  revalidatePath("/agents");
  return { ok: true as const };
}

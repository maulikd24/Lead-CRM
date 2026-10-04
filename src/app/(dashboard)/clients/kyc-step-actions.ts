"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { runKycCheck, transitionKycStep } from "@/lib/kyc/pipeline";

const APPROVER_ROLES = new Set(["ADMIN", "MANAGER"]);

/** Loads the step and checks the user may act on its client: Admins anyone; Managers their team (and unassigned
 * leads); everyone else only their own assigned clients. */
async function authorizeStep(stepId: string) {
  const session = await requireUser();
  const step = await prisma.kycStep.findUnique({ where: { id: stepId }, select: { clientId: true, status: true, client: { select: { assignedToId: true } } } });
  if (!step) throw new Error("KYC step not found");
  const visible = await getVisibleUserIds(session.user.id, session.user.role);
  const assignedToId = step.client.assignedToId;
  const allowed = visible === null || (assignedToId ? visible.includes(assignedToId) : session.user.role === "MANAGER");
  if (!allowed) throw new Error("You don't have access to this client");
  return { session, clientId: step.clientId, status: step.status };
}

function revalidateClient(clientId: string) {
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
}

/** Start a step, or retry a failed one. Anyone working the client. */
export async function startKycStepAction(stepId: string) {
  const { session, clientId, status } = await authorizeStep(stepId);
  // Reopening a Verified/Skipped step is an approver decision (decideKycStepAction), not a "start".
  if (status !== "NOT_STARTED" && status !== "FAILED") throw new Error("Only a not-started or failed step can be started");
  await transitionKycStep(stepId, { to: "IN_PROGRESS" }, session.user.id);
  revalidateClient(clientId);
}

/** Run the configured automation provider. Anyone working the client — the provider, not the user, decides. */
export async function runKycCheckAction(stepId: string) {
  const { session, clientId, status } = await authorizeStep(stepId);
  if (status === "VERIFIED" || status === "SKIPPED") throw new Error("This step is already complete");
  const step = await runKycCheck(stepId, session.user.id);
  revalidateClient(clientId);
  return { status: step.status, failureReason: step.failureReason };
}

const decisionSchema = z.object({
  to: z.enum(["VERIFIED", "FAILED", "SKIPPED", "IN_PROGRESS"]),
  reason: z.string().trim().max(500).optional(),
});

/** A manual decision — verify, fail, waive (skip) or reopen. Maker-checker: approvers (Admin / Manager) only. */
export async function decideKycStepAction(stepId: string, input: z.input<typeof decisionSchema>) {
  const { session, clientId } = await authorizeStep(stepId);
  if (!APPROVER_ROLES.has(session.user.role)) throw new Error("Only Admins and Managers can verify, fail or skip a KYC step");
  const parsed = decisionSchema.parse(input);
  await transitionKycStep(stepId, { to: parsed.to, reason: parsed.reason || undefined, provider: "manual" }, session.user.id);
  revalidateClient(clientId);
}

import { prisma } from "@/lib/db/prisma";
import type { KycStep, KycStepStatus, Prisma } from "@/generated/prisma/client";
import { logActivity } from "@/lib/activities/log-activity";
import { DONE_STATUSES, KYC_STEP_BY_TYPE, KYC_STEPS, holderKeyFor, stepTypesForHolder, unmetDependencies } from "./steps";
import { getKycProvider } from "./providers";

/** Seeds the pipeline for the First Holder and every active joint holder. Idempotent: existing steps are kept,
 * so it is also how a holder added after submission gets their steps. */
export async function seedKycSteps(clientId: string) {
  const holders = await prisma.accountHolder.findMany({ where: { clientId, isDeleted: false }, select: { id: true } });
  const holderIds: (string | null)[] = [null, ...holders.map((h) => h.id)];
  await prisma.kycStep.createMany({
    data: holderIds.flatMap((holderId) =>
      stepTypesForHolder(holderId).map((type) => ({ clientId, holderId, holderKey: holderKeyFor(holderId), type })),
    ),
    skipDuplicates: true,
  });
}

/** A client's steps in pipeline order, excluding those of removed (soft-deleted) joint holders. */
export async function loadKycSteps(clientId: string) {
  const steps = await prisma.kycStep.findMany({
    where: { clientId, OR: [{ holderId: null }, { holder: { isDeleted: false } }] },
    include: { holder: { select: { name: true, position: true } } },
  });
  const order = new Map(KYC_STEPS.map((s, i) => [s.type, i]));
  return steps.sort((a, b) => (a.holderKey === b.holderKey ? 0 : a.holderKey === "PRIMARY" ? -1 : b.holderKey === "PRIMARY" ? 1 : a.holderKey.localeCompare(b.holderKey)) || order.get(a.type)! - order.get(b.type)!);
}

const ALLOWED: Record<KycStepStatus, KycStepStatus[]> = {
  NOT_STARTED: ["IN_PROGRESS", "VERIFIED", "FAILED", "SKIPPED"],
  IN_PROGRESS: ["VERIFIED", "FAILED", "SKIPPED"],
  FAILED: ["IN_PROGRESS", "SKIPPED"], // retry, or waive
  VERIFIED: ["IN_PROGRESS"], // reopen
  SKIPPED: ["IN_PROGRESS"], // reopen
};

export type StepTransition = {
  to: KycStepStatus;
  reason?: string;
  provider?: string;
  providerRef?: string;
  result?: Prisma.InputJsonValue;
};

/** The single place a step changes status: enforces allowed moves, dependency order and reasons, then writes
 * the audit trail. Role checks (who may verify/fail/skip) belong to the caller. */
export async function transitionKycStep(stepId: string, change: StepTransition, actorId: string): Promise<KycStep> {
  const step = await prisma.kycStep.findUniqueOrThrow({ where: { id: stepId } });
  const all = await loadKycSteps(step.clientId);
  const label = KYC_STEP_BY_TYPE.get(step.type)!.label;
  const isRefresh = step.status === "IN_PROGRESS" && change.to === "IN_PROGRESS"; // async check re-run, still pending

  if (!isRefresh && !ALLOWED[step.status].includes(change.to)) throw new Error(`${label}: can't move from ${step.status} to ${change.to}`);
  if ((change.to === "FAILED" || change.to === "SKIPPED" || DONE_STATUSES.includes(step.status)) && !change.reason?.trim()) {
    throw new Error(`${label}: a reason is required`);
  }
  if (change.to !== "SKIPPED") {
    const blockers = unmetDependencies(step, all);
    if (blockers.length > 0) {
      throw new Error(`${label} is waiting on: ${[...new Set(blockers.map((b) => KYC_STEP_BY_TYPE.get(b.type)!.label))].join(", ")}`);
    }
  }
  if (DONE_STATUSES.includes(step.status)) {
    // Reopening: refuse if a later step was already completed on the strength of this one.
    const dependents = all.filter((s) => s.id !== step.id && DONE_STATUSES.includes(s.status) && unmetDependencies(s, all.map((x) => (x.id === step.id ? { ...x, status: "NOT_STARTED" as const } : x))).length > 0);
    if (dependents.length > 0) throw new Error(`${label} can't be reopened: ${dependents.map((d) => KYC_STEP_BY_TYPE.get(d.type)!.label).join(", ")} already depend on it`);
  }

  const decided = change.to === "VERIFIED" || change.to === "FAILED" || change.to === "SKIPPED";
  const updated = await prisma.kycStep.update({
    where: { id: stepId },
    data: {
      status: change.to,
      provider: change.provider ?? step.provider ?? "manual",
      providerRef: change.providerRef ?? step.providerRef,
      result: change.result,
      failureReason: change.to === "FAILED" ? change.reason : null,
      attempts: change.to === "IN_PROGRESS" && !isRefresh ? { increment: 1 } : undefined,
      decidedById: decided ? actorId : null,
      decidedAt: decided ? new Date() : null,
      ...(isRefresh ? {} : { statusChangedAt: new Date(), reminderLevel: 0 }),
    },
  });

  if (!isRefresh) {
    await prisma.auditLog.create({
      data: {
        userId: actorId,
        entity: "KycStep",
        entityId: step.clientId,
        action: `kyc_step_${change.to.toLowerCase()}`,
        oldValue: { step: step.type, holder: step.holderKey, status: step.status },
        newValue: { step: step.type, holder: step.holderKey, status: change.to, provider: updated.provider, providerRef: updated.providerRef },
        reason: change.reason ?? null,
      },
    });
    await logActivity({ clientId: step.clientId, userId: actorId, type: "NOTE", payload: { message: `KYC step ${label}: ${change.to}${change.reason ? ` — ${change.reason}` : ""}` } });
  }

  if (change.to === "FAILED") {
    const client = await prisma.client.findUniqueOrThrow({ where: { id: step.clientId }, select: { name: true, assignedToId: true } });
    if (client.assignedToId && client.assignedToId !== actorId) {
      await prisma.notification.create({
        data: { userId: client.assignedToId, type: "kyc_step_failed", payload: { clientId: step.clientId, clientName: client.name, step: label, reason: change.reason ?? "" } },
      });
    }
  }
  return updated;
}

/** Runs the configured automation provider for one step and records its outcome through transitionKycStep,
 * so automated and manual results get the same validation and audit trail. */
export async function runKycCheck(stepId: string, actorId: string) {
  const provider = getKycProvider();
  const step = await prisma.kycStep.findUniqueOrThrow({
    where: { id: stepId },
    include: { client: { select: { name: true, pan: true, mobile: true, email: true } }, holder: { select: { name: true, pan: true, mobile: true, email: true } } },
  });
  if (!provider || !provider.supports(step.type)) throw new Error("No automated check is available for this step — record it manually");
  // Refuse before calling the provider: a vendor call for a step that can't proceed is wasted (and billed).
  const blockers = unmetDependencies(step, await loadKycSteps(step.clientId));
  if (blockers.length > 0) {
    throw new Error(`${KYC_STEP_BY_TYPE.get(step.type)!.label} is waiting on: ${[...new Set(blockers.map((b) => KYC_STEP_BY_TYPE.get(b.type)!.label))].join(", ")}`);
  }

  const outcome = await provider.run({ type: step.type, providerRef: step.providerRef, person: step.holder ?? step.client });
  // A check is an attempt: record the step as started (a retry, if it had failed) before its outcome.
  if (step.status === "NOT_STARTED" || step.status === "FAILED") {
    await transitionKycStep(stepId, { to: "IN_PROGRESS", provider: provider.key }, actorId);
  }
  return transitionKycStep(
    stepId,
    {
      to: outcome.status,
      reason: outcome.status === "FAILED" ? outcome.failureReason : outcome.status === "VERIFIED" && DONE_STATUSES.includes(step.status) ? "Re-verified by provider" : undefined,
      provider: provider.key,
      providerRef: outcome.providerRef,
      result: outcome.result,
    },
    actorId,
  );
}

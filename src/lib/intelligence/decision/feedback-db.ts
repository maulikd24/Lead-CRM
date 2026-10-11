// Applies a feedback plan. Authorisation first (the same rules as reading a decision), then one transaction for the feedback row, the
// decision status and the dismissal; the Task and the audit row follow. Nothing here sends a message.
import { basePrisma } from "@/lib/db/prisma";
import { createTaskIfNotExists } from "@/lib/stage-engine/create-task-if-not-exists";
import { canSeeDecision, type Viewer } from "./access";
import { planFeedback, type DecisionSnapshot, type UserFeedback } from "./feedback";
import { defaultSeams, type DecisionSeams } from "./seams";
import type { AssetClass } from "../constants";
import { isAssetClass } from "../constants";

export type FeedbackResult = { ok: true; status: string; taskId: string | null } | { ok: false; error: string };

export async function applyFeedback(input: { decisionId: string; viewer: Viewer; visibleUserIds: string[] | null; feedback: UserFeedback; env?: Record<string, string | undefined>; now?: Date; seams?: Partial<DecisionSeams> }): Promise<FeedbackResult> {
  const now = input.now ?? new Date();
  const seams = { ...defaultSeams(), ...input.seams };
  const row = await basePrisma.decisionRecord.findUnique({
    where: { id: input.decisionId },
    select: { id: true, clientId: true, correlationId: true, result: true, action: true, programme: true, topic: true, assetClass: true, timing: true, chosenRuleKey: true, chosenFingerprint: true, status: true, client: { select: { assignedToId: true, mergedIntoId: true, isDeleted: true } } },
  });
  // Not found and not allowed look the same: a decision's existence is not itself visible.
  if (!row || row.client.mergedIntoId || row.client.isDeleted || !canSeeDecision(input.viewer, input.visibleUserIds, row.client, input.env ?? process.env)) return { ok: false, error: "Decision not found" };

  const snapshot: DecisionSnapshot = { id: row.id, result: row.result, action: row.action, programme: row.programme, topic: row.topic, assetClass: row.assetClass, timing: row.timing, chosenRuleKey: row.chosenRuleKey, chosenFingerprint: row.chosenFingerprint, status: row.status };
  const plan = planFeedback(snapshot, input.feedback, now, row.client.assignedToId ?? (input.viewer.role === "RM" ? input.viewer.id : null));
  if (!plan.ok) return plan;

  await basePrisma.$transaction(async (tx) => {
    await tx.decisionFeedback.create({ data: { decisionId: row.id, userId: input.viewer.id, kind: plan.feedback.kind, reason: plan.feedback.reason, until: plan.feedback.until, scope: plan.feedback.scope } });
    await tx.decisionRecord.update({ where: { id: row.id }, data: { status: plan.status, statusUpdatedAt: now } });
    if (plan.dismissal) {
      await tx.suggestionDismissal.create({ data: { clientId: row.clientId, ruleKey: plan.dismissal.ruleKey, fingerprint: plan.dismissal.fingerprint, reason: plan.dismissal.reason, dismissedById: input.viewer.id, snoozeUntil: plan.dismissal.snoozeUntil } });
    }
    await tx.auditLog.create({ data: { userId: input.viewer.id, entity: "DecisionRecord", entityId: row.id, action: `decision_feedback_${plan.feedback.kind}`, newValue: { kind: plan.feedback.kind, reason: plan.feedback.reason, status: plan.status } } });
  });

  let taskId: string | null = null;
  if (plan.task) taskId = (await createTaskIfNotExists({ clientId: row.clientId, assignedToId: plan.task.assignedToId, title: plan.task.title, dueAt: plan.task.dueAt, source: plan.task.source })).id;
  if (plan.suppression) {
    await seams.memoryWrite.writeSuppression({ clientId: row.clientId, scope: plan.suppression.scope, assetClass: isAssetClass(plan.suppression.assetClass) ? (plan.suppression.assetClass as AssetClass) : null, reason: plan.suppression.reason, until: plan.suppression.until, byUserId: input.viewer.id, decisionId: row.id });
  }
  await seams.events.emit({ type: "nba.decision.feedback", clientId: row.clientId, decisionId: row.id, correlationId: row.correlationId, payload: { kind: plan.feedback.kind, reason: plan.feedback.reason } });
  return { ok: true, status: plan.status, taskId };
}

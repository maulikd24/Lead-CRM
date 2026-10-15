"use server";

import { revalidatePath } from "next/cache";

import { requireAccess } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { prisma } from "@/lib/db/prisma";
import { simulate, type SimResult } from "@/lib/simulate/engine";
import { bulkFollowUpAction, MAX_BULK_TASKS, planBulkTasks, validateBulkParams, type BulkFollowUpParams } from "@/lib/simulate/bulk-tasks";
import { loadTargetFacts } from "@/lib/simulate/facts-db";
import { simulateEnabled } from "@/lib/simulate/flag";

/**
 * Bulk follow-up tasks with a dry run first (flag NEXT_PUBLIC_SIMULATE). Both actions are guarded by the registry (area "clients",
 * action "manage"), work only on customers the viewer may see, and neither sends anything: the preview changes nothing, and creating
 * tasks writes ordinary Task rows for the customers the preview said were eligible, then an audit row.
 */
const MAX_IDS = 500;

type Preview = { ok: true; result: SimResult; outOfScope: number; capped: boolean } | { ok: false; error: string };

async function scoped(clientIds: unknown, userId: string, role: string) {
  const ids = Array.isArray(clientIds) ? [...new Set(clientIds.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64))].slice(0, MAX_IDS) : [];
  const visible = await getVisibleUserIds(userId, role as Parameters<typeof getVisibleUserIds>[1]);
  const rows = await prisma.client.findMany({ where: { id: { in: ids }, isDeleted: false, ...(visible ? { assignedToId: { in: visible } } : {}) }, select: { id: true, assignedToId: true } });
  return { ids: rows.map((r) => r.id), owners: new Map(rows.map((r) => [r.id, r.assignedToId])), requested: ids.length };
}

type Run = { error: string } | { params: BulkFollowUpParams; scope: Awaited<ReturnType<typeof scoped>>; result: SimResult };

async function run(clientIds: unknown, raw: BulkFollowUpParams, userId: string, role: string, now: Date): Promise<Run> {
  const v = validateBulkParams(raw);
  if (!v.ok) return { error: v.error };
  const s = await scoped(clientIds, userId, role);
  if (s.ids.length === 0) return { error: "Select at least one customer you can see." };
  const action = bulkFollowUpAction(v.params);
  const facts = await loadTargetFacts(s.ids, now, { recentContactHours: action.recentContactHours, windowDays: action.frequencyCap.windowDays });
  // The preview is conservative on purpose: simulate() applies the consent policy as if it were enforced, whatever CONSENT_ENFORCEMENT says.
  return { params: v.params, scope: s, result: simulate(action, facts, now) };
}

export async function simulateBulkFollowUpAction(clientIds: string[], params: BulkFollowUpParams): Promise<Preview> {
  const session = await requireAccess("clients", "manage");
  if (!simulateEnabled()) return { ok: false, error: "Preview is not switched on." };
  const out = await run(clientIds, params, session.user.id, session.user.role, new Date());
  if ("error" in out) return { ok: false, error: out.error };
  return { ok: true, result: out.result, outOfScope: out.scope.requested - out.scope.ids.length, capped: out.result.eligible.length > MAX_BULK_TASKS };
}

export type CreateResult = { ok: true; created: number; suppressed: number; alreadyOpen: number } | { ok: false; error: string };

export async function createBulkFollowUpTasksAction(clientIds: string[], params: BulkFollowUpParams): Promise<CreateResult> {
  const session = await requireAccess("clients", "manage");
  if (!simulateEnabled()) return { ok: false, error: "Preview is not switched on." };
  const now = new Date();
  const out = await run(clientIds, params, session.user.id, session.user.role, now);
  if ("error" in out) return { ok: false, error: out.error };
  const plan = planBulkTasks(out.result, out.scope.owners, out.params, now, session.user.id);
  if (plan.length === 0) return { ok: false, error: "Nobody on this list is eligible right now, so no task was created." };
  // Never create the same open task twice: skip a customer who already has this bulk task pending.
  const existing = await prisma.task.findMany({ where: { clientId: { in: plan.map((p) => p.clientId) }, source: "bulk-follow-up", status: { in: ["PENDING", "OVERDUE"] }, title: { in: plan.map((p) => p.title) } }, select: { clientId: true, title: true } });
  const have = new Set(existing.map((e) => `${e.clientId}|${e.title}`));
  const fresh = plan.filter((p) => !have.has(`${p.clientId}|${p.title}`));
  if (fresh.length > 0) {
    await prisma.$transaction([
      prisma.task.createMany({ data: fresh }),
      prisma.auditLog.create({ data: { userId: session.user.id, entity: "Task", entityId: "bulk-follow-up", action: "bulk_follow_up_tasks", newValue: { requested: out.scope.requested, eligible: out.result.eligible.length, created: fresh.length, suppressed: out.result.suppressed.length, reasons: out.result.reasonCounts, channel: out.params.channel, kind: out.params.kind }, reason: out.params.title } }),
    ]);
  }
  revalidatePath("/clients");
  revalidatePath("/tasks");
  return { ok: true, created: fresh.length, suppressed: out.result.suppressed.length, alreadyOpen: plan.length - fresh.length };
}

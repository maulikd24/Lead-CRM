import { Prisma } from "@/generated/prisma/client";
import { basePrisma as db } from "@/lib/db/prisma";

import type { ExistingItem, Finding, ReconcilePlan } from "./model";

export const loadExisting = async (checkKeys: readonly string[]): Promise<ExistingItem[]> =>
  db.dataHealthItem.findMany({ where: { checkKey: { in: [...checkKeys] } }, select: { id: true, checkKey: true, subjectType: true, subjectId: true, status: true } });

/** Applies a reconcile plan. Touching an item refreshes `lastSeenAt` and its detail (counts change), and reopens a resolved one. */
export async function applyPlan(plan: ReconcilePlan, found: readonly Finding[], now: Date): Promise<{ created: number; touched: number; resolved: number }> {
  const byId = new Map(found.map((f) => [`${f.checkKey}|${f.subjectType}|${f.subjectId}`, f]));
  const existing = plan.touch.length ? await db.dataHealthItem.findMany({ where: { id: { in: plan.touch.map((t) => t.id) } }, select: { id: true, checkKey: true, subjectType: true, subjectId: true } }) : [];
  for (const row of existing) {
    const f = byId.get(`${row.checkKey}|${row.subjectType}|${row.subjectId}`);
    const t = plan.touch.find((x) => x.id === row.id)!;
    await db.dataHealthItem.update({ where: { id: row.id }, data: { lastSeenAt: now, severity: f?.severity, title: f?.title, detail: f?.detail ? (f.detail as Prisma.InputJsonValue) : Prisma.DbNull, ...(t.reopen ? { status: "OPEN", resolvedAt: null, acknowledgedAt: null, acknowledgedById: null } : {}) } });
  }
  if (plan.create.length) {
    await db.dataHealthItem.createMany({
      data: plan.create.map((f) => ({ checkKey: f.checkKey, subjectType: f.subjectType, subjectId: f.subjectId, clientId: f.clientId ?? null, severity: f.severity, title: f.title, detail: f.detail ? (f.detail as Prisma.InputJsonValue) : Prisma.DbNull, firstSeenAt: now, lastSeenAt: now })),
      skipDuplicates: true,
    });
  }
  if (plan.resolve.length) await db.dataHealthItem.updateMany({ where: { id: { in: plan.resolve }, status: { not: "RESOLVED" } }, data: { status: "RESOLVED", resolvedAt: now } });
  return { created: plan.create.length, touched: plan.touch.length, resolved: plan.resolve.length };
}

"use server";

import { revalidatePath } from "next/cache";

import { requireAccess } from "@/lib/auth/require-role";
import { runDataHealth } from "@/lib/data-health/job-db";
import { retryDeadLetterById } from "@/lib/events/consumers-db";
import { prisma } from "@/lib/db/prisma";

/**
 * The audited actions of the Data health tab, ADMIN only through the central registry (area "control-plane", action "manage"):
 * acknowledge a work item, run the checks now, retry a dead-lettered event. Nothing here sends a message or touches a customer record.
 */
const PATH = "/settings/control-plane";
const validId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

export async function acknowledgeDataHealthAction(itemId: string): Promise<{ ok: boolean }> {
  const session = await requireAccess("control-plane", "manage");
  if (!validId(itemId)) return { ok: false };
  const done = await prisma.dataHealthItem.updateMany({ where: { id: itemId, status: "OPEN" }, data: { status: "ACKNOWLEDGED", acknowledgedById: session.user.id, acknowledgedAt: new Date() } });
  if (done.count === 1) await prisma.auditLog.create({ data: { userId: session.user.id, entity: "ControlPlane", entityId: itemId, action: "control_plane.data_health_acknowledge", reason: null } });
  revalidatePath(PATH);
  return { ok: done.count === 1 };
}

export type RunNowResult = { ok: boolean; reason?: "flag-off"; findings?: number };

export async function runDataHealthNowAction(): Promise<RunNowResult> {
  const session = await requireAccess("control-plane", "manage");
  const out = await runDataHealth({ force: true });
  if ("skipped" in out && out.skipped) return { ok: false, reason: "flag-off" };
  await prisma.auditLog.create({ data: { userId: session.user.id, entity: "ControlPlane", entityId: "data-health", action: "control_plane.data_health_run", reason: `findings ${out.findings}` } });
  revalidatePath(PATH);
  return { ok: true, findings: Number(out.findings ?? 0) };
}

export async function retryDeadLetterAction(deadLetterId: string): Promise<{ ok: boolean; reason?: string }> {
  const session = await requireAccess("control-plane", "manage");
  if (!validId(deadLetterId)) return { ok: false, reason: "not_found" };
  const r = await retryDeadLetterById(deadLetterId);
  await prisma.auditLog.create({ data: { userId: session.user.id, entity: "ControlPlane", entityId: deadLetterId, action: "control_plane.dead_letter_retry", reason: r.ok ? "resolved" : r.reason } });
  revalidatePath(PATH);
  return r.ok ? { ok: true } : { ok: false, reason: r.reason };
}

"use server";

import { revalidatePath } from "next/cache";

import { requireAccess } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { retryLeadIntake } from "@/lib/leads/retry";
import { acknowledgeAlert } from "@/lib/system/alerts-db";
import { retryJob, type RetryResult } from "@/lib/system/job-retry";
import { retryDeps } from "@/lib/system/job-retry-db";

/**
 * The three audited actions of the control plane, all ADMIN only through the central registry (area "control-plane", action "manage"):
 * retry a failed idempotent job, retry failed lead intakes, acknowledge an alert. Nothing here sends a message or an email.
 */
const PATH = "/settings/control-plane";

export async function retryJobAction(runId: string): Promise<RetryResult> {
  const session = await requireAccess("control-plane", "manage");
  if (typeof runId !== "string" || runId.length === 0 || runId.length > 64) return { outcome: "refused", reason: "not-found" };
  const result = await retryJob(retryDeps, { runId, userId: session.user.id });
  revalidatePath(PATH);
  return result;
}

export type RetryLeadsResult = { recovered: number; stillFailing: number; skipped: number };

export async function retryLeadsAction(ids: string[]): Promise<RetryLeadsResult> {
  const session = await requireAccess("control-plane", "manage");
  const out: RetryLeadsResult = { recovered: 0, stillFailing: 0, skipped: 0 };
  for (const id of (Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string" && x.length <= 64).slice(0, 10)) {
    const r = await retryLeadIntake(id);
    if (r.outcome === "recovered") out.recovered += 1;
    else if (r.outcome === "still-failing") out.stillFailing += 1;
    else out.skipped += 1;
  }
  await prisma.auditLog.create({ data: { userId: session.user.id, entity: "ControlPlane", entityId: "LeadIntake", action: "control_plane.retry_leads", reason: `recovered ${out.recovered}, still failing ${out.stillFailing}, skipped ${out.skipped}` } });
  revalidatePath(PATH);
  return out;
}

export async function acknowledgeAlertAction(alertId: string): Promise<{ ok: boolean }> {
  const session = await requireAccess("control-plane", "manage");
  if (typeof alertId !== "string" || alertId.length === 0 || alertId.length > 64) return { ok: false };
  const ok = await acknowledgeAlert(alertId, session.user.id);
  if (ok) await prisma.auditLog.create({ data: { userId: session.user.id, entity: "ControlPlane", entityId: alertId, action: "control_plane.acknowledge", reason: null } });
  revalidatePath(PATH);
  return { ok };
}

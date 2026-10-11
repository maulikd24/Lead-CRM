"use server";

import { revalidatePath } from "next/cache";

import { approveDigest, createShare, discardDigest, loadDirectorReport, revokeShare } from "@/lib/director/db";
import { saveDigestSettings } from "@/lib/creative/settings";
import { addDays, todayInTimeZone } from "@/lib/marketing/dates";
import type { Action } from "@/lib/access/policy";
import { requireMarketing } from "@/lib/auth/require-role";
import { directorReportsEnabled } from "@/lib/creative/flags";

import { OFF, text, type Actor, type ActionResult } from "./creative-gate";

/** The one door for every action here: the central registry (requireMarketing, area marketing-reports), then the feature flag. Null when switched off. */
async function gate(area: "marketing-reports", action: Action = "export"): Promise<Actor | null> {
  const session = await requireMarketing(area, action);
  return directorReportsEnabled() ? { id: session.user.id, role: session.user.role as string } : null;
}

/**
 * Server actions for director reports and the weekly digest. Same door as the creative actions (ADMIN or MARKETING, flag
 * on). A shareable link is created from a fresh report; its token is returned once and never stored in the clear.
 */

const REAL_DAY = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

function range(fromIn: unknown, toIn: unknown): { from: string; to: string } | null {
  const from = text(fromIn, 10);
  const to = text(toIn, 10);
  if (!REAL_DAY(from) || !REAL_DAY(to) || from > to) return null;
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > 90 || to > addDays(todayInTimeZone(new Date(), "Asia/Kolkata"), 0)) return null;
  return { from, to };
}

export async function createShareAction(input: { from: unknown; to: unknown; expiryDays?: unknown; label?: unknown }): Promise<ActionResult<{ id: string; path: string; expiresAt: string }>> {
  const actor = await gate("marketing-reports");
  if (!actor) return OFF;
  const r = range(input.from, input.to);
  if (!r) return { ok: false, error: "Choose a period of up to 90 days that has already ended or is today." };
  const report = await loadDirectorReport(r.from, r.to);
  const share = await createShare({ report, userId: actor.id, expiryDays: typeof input.expiryDays === "number" ? input.expiryDays : undefined, label: text(input.label, 80) });
  revalidatePath("/marketing");
  return { ok: true, id: share.id, path: `/shared/report/${share.token}`, expiresAt: share.expiresAt.toISOString() };
}

export async function revokeShareAction(id: unknown): Promise<ActionResult> {
  const actor = await gate("marketing-reports");
  if (!actor) return OFF;
  const ok = await revokeShare(text(id, 64), actor.id);
  revalidatePath("/marketing");
  return ok ? { ok: true } : { ok: false, error: "That link is already revoked or does not exist." };
}

export async function approveDigestAction(id: unknown): Promise<ActionResult> {
  const actor = await gate("marketing-reports");
  if (!actor) return OFF;
  const ok = await approveDigest(text(id, 64), actor.id);
  revalidatePath("/marketing");
  return ok ? { ok: true } : { ok: false, error: "That digest is no longer a draft." };
}

export async function discardDigestAction(id: unknown): Promise<ActionResult> {
  const actor = await gate("marketing-reports");
  if (!actor) return OFF;
  const ok = await discardDigest(text(id, 64), actor.id);
  revalidatePath("/marketing");
  return ok ? { ok: true } : { ok: false, error: "That digest is no longer a draft." };
}

/** Who receives the weekly digest, and whether it runs at all. Admin only. */
export async function saveDigestSettingsAction(input: { enabled: unknown; recipients: unknown }): Promise<ActionResult> {
  const actor = await gate("marketing-reports", "manage");
  if (!actor) return OFF;
  const list = typeof input.recipients === "string" ? input.recipients.split(/[\s,;]+/).filter(Boolean) : Array.isArray(input.recipients) ? input.recipients : [];
  const res = await saveDigestSettings({ enabled: input.enabled === true, recipients: list }, actor.id);
  revalidatePath("/marketing");
  return res;
}

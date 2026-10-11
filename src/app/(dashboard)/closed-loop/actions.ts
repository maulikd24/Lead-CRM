"use server";

import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { encryptJson, decryptJson } from "@/lib/security/crypto";
import { requireMarketing } from "@/lib/auth/require-role";
import { closedLoopEnabled, demoDestinationAllowed, parseBandsText, parseDestinationSettings, parseGlobalSettings, REAL_FIELDS } from "@/lib/closedloop/config";
import { createPrismaOutbox, GLOBAL_PROVIDER, providerOf } from "@/lib/closedloop/db";
import { DESTINATION_KEYS, type DestinationKey } from "@/lib/closedloop/types";
import { checkConsentNotice, classifyDestinationChange, CONSENT_ENTITY, DESTINATION_ENTITY } from "@/lib/closedloop/approvals";
import { ApprovalBlockedError, requestApproval } from "@/lib/policy/approvals/service";
import type { Role } from "@/generated/prisma/client";

/** `pending`: the change was recorded as a request that a second Admin must approve in the Approvals inbox; nothing has changed yet. */
type Result = { ok: true; pending?: true } | { ok: false; error: string };

/** The module ships dark: with the flag off every action behaves as if the page did not exist. Checked after sign-in and role, so a visitor learns nothing either way. */
function requireFlag() {
  if (!closedLoopEnabled()) notFound();
}

async function audit(userId: string, action: string, entityId: string, newValue: Record<string, unknown>) {
  // Names and switches only. Credential values are never written anywhere but the encrypted settings row.
  await prisma.auditLog.create({ data: { userId, entity: "ClosedLoop", entityId, action, newValue: newValue as never } });
}

export async function retryOutboxRowAction(id: string): Promise<Result> {
  const session = await requireMarketing("marketing-attribution", "view");
  requireFlag();
  if (typeof id !== "string" || id.length > 40) return { ok: false, error: "Unknown event." };
  const ok = await createPrismaOutbox(prisma).requeue(id, new Date());
  if (ok) await audit(session.user.id, "retry_event", id, {});
  revalidatePath("/closed-loop");
  return ok ? { ok: true } : { ok: false, error: "Only an event that failed can be retried." };
}

/** Turning it ON is open to Marketing (stop everything fast); turning it OFF again is an Admin decision. */
export async function setKillSwitchAction(on: boolean): Promise<Result> {
  const session = on ? await requireMarketing("marketing-attribution", "view") : await requireMarketing("marketing-attribution", "manage");
  requireFlag();
  const row = await prisma.integrationConfig.findUnique({ where: { provider: GLOBAL_PROVIDER } });
  const settings = { ...parseGlobalSettings(row?.settings), killSwitch: on === true };
  await prisma.integrationConfig.upsert({ where: { provider: GLOBAL_PROVIDER }, update: { settings }, create: { provider: GLOBAL_PROVIDER, settings } });
  await audit(session.user.id, on ? "kill_switch_on" : "kill_switch_off", GLOBAL_PROVIDER, { killSwitch: on === true });
  revalidatePath("/closed-loop");
  return { ok: true };
}

export type DestinationInput = { enabled: boolean; region: string; allowedRegions: string; sendValue: boolean; credentials: Record<string, string> };

const SHORT = 40;

export async function saveDestinationAction(key: DestinationKey, input: DestinationInput): Promise<Result> {
  const session = await requireMarketing("marketing-attribution", "manage");
  requireFlag();
  if (!DESTINATION_KEYS.includes(key)) return { ok: false, error: "Unknown destination." };
  if (key === "fake" && !demoDestinationAllowed()) return { ok: false, error: "The demo destination is not available." };
  const region = String(input.region ?? "").trim().toLowerCase();
  const allowed = String(input.allowedRegions ?? "").split(/[,\n]+/).map((r) => r.trim().toLowerCase()).filter(Boolean);
  if (region.length > SHORT || allowed.length > 10 || allowed.some((r) => r.length > SHORT)) return { ok: false, error: "Regions must be short names (at most 40 characters, at most 10 of them)." };

  const fields = key === "fake" ? [] : REAL_FIELDS[key].map((f) => f.key);
  const incoming = input.credentials ?? {};
  if (Object.keys(incoming).some((k) => !fields.includes(k))) return { ok: false, error: "Unknown credential field." };
  if (Object.values(incoming).some((v) => typeof v !== "string" || v.length > 2000)) return { ok: false, error: "A credential value is too long." };

  const provider = providerOf(key);
  const row = await prisma.integrationConfig.findUnique({ where: { provider } });
  const existing = row?.credentials ? decryptJson<Record<string, string>>(row.credentials as string) : {};
  // A blank box means "keep what is stored": a secret is never shown back, so an Admin cannot be expected to retype it.
  const merged: Record<string, string> = { ...existing };
  for (const [k, v] of Object.entries(incoming)) if (v.trim() !== "") merged[k] = v.trim();
  const wanted = parseDestinationSettings({ enabled: input.enabled === true, region, allowedRegions: allowed, sendValue: input.sendValue === true });
  const current = parseDestinationSettings(row?.settings);
  // Anything that lets data start going, or go further, to a third party waits for a second Admin (the canonical approval service); a stop applies at once.
  const needsApproval = classifyDestinationChange(current, wanted) === "needs_approval";
  const settings = needsApproval ? current : wanted;
  const credentials = encryptJson(merged);

  await prisma.integrationConfig.upsert({ where: { provider }, update: { credentials, settings, isEnabled: settings.enabled, mode: key === "fake" ? "mock" : "live" }, create: { provider, credentials, settings, isEnabled: settings.enabled, mode: key === "fake" ? "mock" : "live" } });
  await audit(session.user.id, "destination_saved", key, { ...settings, changedFields: Object.keys(incoming).filter((k) => incoming[k].trim() !== ""), approvalRequested: needsApproval });
  if (needsApproval) {
    await requestApproval(
      "CLOSED_LOOP_DESTINATION",
      { entity: DESTINATION_ENTITY, entityId: key, payload: { destination: key, enabled: wanted.enabled, region: wanted.region ?? "", allowedRegions: wanted.allowedRegions, sendValue: wanted.sendValue } },
      { id: session.user.id, role: session.user.role as Role },
    );
  }
  revalidatePath("/closed-loop");
  return needsApproval ? { ok: true, pending: true } : { ok: true };
}

/** The customer-facing ad measurement wording. Compliance owns the text; this only files the request, and a second Admin approves it in the Approvals inbox. */
export async function proposeAdsNoticeAction(text: string, version: string): Promise<Result> {
  const session = await requireMarketing("marketing-attribution", "manage");
  requireFlag();
  const payload = { purpose: "ADS_MEASUREMENT" as const, text: String(text ?? "").trim(), version: String(version ?? "").trim() };
  try {
    await checkConsentNotice(payload);
  } catch (e) {
    if (e instanceof ApprovalBlockedError) return { ok: false, error: e.reasons[0] ?? e.message };
    throw e;
  }
  await requestApproval("CONSENT_POLICY_CHANGE", { entity: CONSENT_ENTITY, entityId: "ADS_MEASUREMENT", payload }, { id: session.user.id, role: session.user.role as Role });
  await audit(session.user.id, "consent_notice_proposed", "ADS_MEASUREMENT", { version: payload.version });
  revalidatePath("/closed-loop");
  return { ok: true, pending: true };
}

export async function saveAumBandsAction(text: string): Promise<Result> {
  const session = await requireMarketing("marketing-attribution", "manage");
  requireFlag();
  const parsed = parseBandsText(String(text ?? ""));
  if (!parsed.ok) return parsed;
  const row = await prisma.integrationConfig.findUnique({ where: { provider: GLOBAL_PROVIDER } });
  const settings = { ...parseGlobalSettings(row?.settings), aumBands: parsed.bands };
  await prisma.integrationConfig.upsert({ where: { provider: GLOBAL_PROVIDER }, update: { settings }, create: { provider: GLOBAL_PROVIDER, settings } });
  await audit(session.user.id, "aum_bands_saved", GLOBAL_PROVIDER, { bands: parsed.bands?.length ?? 0 });
  revalidatePath("/closed-loop");
  return { ok: true };
}

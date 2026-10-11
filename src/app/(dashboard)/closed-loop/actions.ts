"use server";

import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { encryptJson, decryptJson } from "@/lib/security/crypto";
import { requireClosedLoopAccess, requireClosedLoopAdmin } from "@/lib/closedloop/access";
import { closedLoopEnabled, demoDestinationAllowed, parseBandsText, parseDestinationSettings, parseGlobalSettings, REAL_FIELDS } from "@/lib/closedloop/config";
import { createPrismaOutbox, GLOBAL_PROVIDER, providerOf } from "@/lib/closedloop/db";
import { DESTINATION_KEYS, type DestinationKey } from "@/lib/closedloop/types";

type Result = { ok: true } | { ok: false; error: string };

/** The module ships dark: with the flag off every action behaves as if the page did not exist. Checked after sign-in and role, so a visitor learns nothing either way. */
function requireFlag() {
  if (!closedLoopEnabled()) notFound();
}

async function audit(userId: string, action: string, entityId: string, newValue: Record<string, unknown>) {
  // Names and switches only. Credential values are never written anywhere but the encrypted settings row.
  await prisma.auditLog.create({ data: { userId, entity: "ClosedLoop", entityId, action, newValue: newValue as never } });
}

export async function retryOutboxRowAction(id: string): Promise<Result> {
  const session = await requireClosedLoopAccess();
  requireFlag();
  if (typeof id !== "string" || id.length > 40) return { ok: false, error: "Unknown event." };
  const ok = await createPrismaOutbox(prisma).requeue(id, new Date());
  if (ok) await audit(session.user.id, "retry_event", id, {});
  revalidatePath("/closed-loop");
  return ok ? { ok: true } : { ok: false, error: "Only an event that failed can be retried." };
}

/** Turning it ON is open to Marketing (stop everything fast); turning it OFF again is an Admin decision. */
export async function setKillSwitchAction(on: boolean): Promise<Result> {
  const session = on ? await requireClosedLoopAccess() : await requireClosedLoopAdmin();
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
  const session = await requireClosedLoopAdmin();
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
  const settings = parseDestinationSettings({ enabled: input.enabled === true, region, allowedRegions: allowed, sendValue: input.sendValue === true });
  const credentials = encryptJson(merged);

  await prisma.integrationConfig.upsert({ where: { provider }, update: { credentials, settings, isEnabled: settings.enabled }, create: { provider, credentials, settings, isEnabled: settings.enabled } });
  await audit(session.user.id, "destination_saved", key, { ...settings, changedFields: Object.keys(incoming).filter((k) => incoming[k].trim() !== "") });
  revalidatePath("/closed-loop");
  return { ok: true };
}

export async function saveAumBandsAction(text: string): Promise<Result> {
  const session = await requireClosedLoopAdmin();
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

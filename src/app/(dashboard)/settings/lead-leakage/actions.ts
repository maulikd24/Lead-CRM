"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";

import { requireMarketing } from "@/lib/auth/require-role";
import { saveSettings } from "@/lib/attribution/db";
import { attributionEnabled } from "@/lib/attribution/flag";
import { validateSettingsInput, type AttributionSettings } from "@/lib/attribution/settings";
import { prisma } from "@/lib/db/prisma";

/** The speed-to-lead SLA and the escalation grace period. Admin only, behind the attribution flag; every change leaves an audit entry. */
export async function saveAttributionSettingsAction(input: unknown): Promise<{ ok: true; settings: AttributionSettings } | { ok: false; error: string }> {
  const session = await requireMarketing("marketing-attribution", "manage");
  if (!attributionEnabled()) notFound();
  const parsed = validateSettingsInput(input);
  if (!parsed.ok) return parsed;
  await saveSettings(parsed.value, session.user.id);
  await prisma.auditLog.create({ data: { userId: session.user.id, entity: "AttributionSetting", entityId: "lead-sla", action: "lead_sla_changed", newValue: { ...parsed.value } } });
  revalidatePath("/settings/lead-leakage");
  return { ok: true, settings: parsed.value };
}

"use server";

import { revalidatePath } from "next/cache";

import { requireAccess } from "@/lib/auth/require-role";
import { saveAllowedDomains, type Result } from "@/lib/auth/google/admin";
import { googleSettingsDb } from "@/lib/auth/google/admin-wiring";
import { recordTrustSignoff, revokeTrustSignoff, type Change as TrustChange } from "@/lib/front-door/trust-signoff";
import { trustSignoffDb } from "@/lib/front-door/trust-wiring";

export type SignInSettingsState = { result?: Result };

/** Admin only (the registry says so here, and the service checks the role again). Writes one audit row when the list changes. */
export async function saveAllowedDomainsAction(_prev: SignInSettingsState, formData: FormData): Promise<SignInSettingsState> {
  const session = await requireAccess("settings-sign-in", "manage");
  const result = await saveAllowedDomains(googleSettingsDb, { id: session.user.id, role: session.user.role }, formData.get("domains"));
  revalidatePath("/settings/sign-in");
  return { result };
}

export type TrustState = { result?: TrustChange };

/** Records the compliance sign-off of the trust-strip wording: Admin only, audited. Until it exists the front door hides the strip. */
export async function recordTrustSignoffAction(_prev: TrustState, formData: FormData): Promise<TrustState> {
  const session = await requireAccess("settings-sign-in", "manage");
  const result = await recordTrustSignoff(trustSignoffDb, { id: session.user.id, role: session.user.role }, { confirm: formData.get("confirm") === "on", reviewerName: formData.get("reviewerName"), reviewedOn: formData.get("reviewedOn") });
  revalidatePath("/settings/sign-in");
  revalidatePath("/");
  return { result };
}

export async function revokeTrustSignoffAction(_prev: TrustState): Promise<TrustState> {
  const session = await requireAccess("settings-sign-in", "manage");
  const result = await revokeTrustSignoff(trustSignoffDb, { id: session.user.id, role: session.user.role });
  revalidatePath("/settings/sign-in");
  revalidatePath("/");
  return { result };
}

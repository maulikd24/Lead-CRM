"use server";

import { revalidatePath } from "next/cache";

import { requireAccess } from "@/lib/auth/require-role";
import { saveAllowedDomains, type Result } from "@/lib/auth/google/admin";
import { googleSettingsDb } from "@/lib/auth/google/admin-wiring";

export type SignInSettingsState = { result?: Result };

/** Admin only (the registry says so here, and the service checks the role again). Writes one audit row when the list changes. */
export async function saveAllowedDomainsAction(_prev: SignInSettingsState, formData: FormData): Promise<SignInSettingsState> {
  const session = await requireAccess("settings-sign-in", "manage");
  const result = await saveAllowedDomains(googleSettingsDb, { id: session.user.id, role: session.user.role }, formData.get("domains"));
  revalidatePath("/settings/sign-in");
  return { result };
}

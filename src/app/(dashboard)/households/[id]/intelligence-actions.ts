"use server";

import { revalidatePath } from "next/cache";

import { requireAccess } from "@/lib/auth/require-role";
import { recordRelationshipConsent } from "@/lib/households/privacy/load";
import { householdIntelligenceEnabled } from "@/lib/memory/flag";

export type ConsentActionResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * A member's relationship consent: what may be shown to the other members' relationship managers. Recorded by someone who
 * looks after THAT member (checked in the loader against the member's own record scope); the actor comes from the session.
 */
export async function recordHouseholdConsentAction(input: { householdId: string; subjectClientId: string; granteeClientId: string | null; status: string; scopes: string[]; evidenceRef?: string }): Promise<ConsentActionResult> {
  const session = await requireAccess("household-intelligence", "manage");
  if (!householdIntelligenceEnabled()) return { ok: false, error: "Not available." };
  const status = input.status === "WITHDRAWN" ? "WITHDRAWN" : "GRANTED";
  const r = await recordRelationshipConsent(
    { userId: session.user.id, role: session.user.role },
    { householdId: String(input.householdId), subjectClientId: String(input.subjectClientId), granteeClientId: input.granteeClientId ? String(input.granteeClientId) : null, status, scopes: Array.isArray(input.scopes) ? input.scopes.map(String) : [], evidenceRef: typeof input.evidenceRef === "string" ? input.evidenceRef.trim().slice(0, 200) || null : null },
  );
  if (!r.ok) return { ok: false, error: r.message };
  revalidatePath(`/households/${input.householdId}`);
  return { ok: true, message: status === "GRANTED" ? "Consent recorded." : "Consent withdrawn. The wall is closed again." };
}

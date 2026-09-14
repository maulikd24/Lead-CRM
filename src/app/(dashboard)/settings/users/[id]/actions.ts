"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { encryptField, decryptField } from "@/lib/security/encrypted-fields";

const editPartnerProfileSchema = z.object({
  region: z.string().optional(),
  arnCode: z.string().optional(),
  euinCode: z.string().optional(),
  gstin: z.string().optional(),
  panNumber: z.string().optional(),
});

/** panNumber/gstin are encrypted at rest (encryptField/decryptField wrap the existing
 * encryptJson/decryptJson helper already used for IntegrationConfig.credentials). */
export async function editPartnerProfileAction(profileId: string, formData: FormData) {
  await requireRole(["ADMIN"]);

  const parsed = editPartnerProfileSchema.parse({
    region: formData.get("region") || undefined,
    arnCode: formData.get("arnCode") || undefined,
    euinCode: formData.get("euinCode") || undefined,
    gstin: formData.get("gstin") || undefined,
    panNumber: formData.get("panNumber") || undefined,
  });

  // Blank panNumber/gstin means "leave unchanged" (they're never pre-filled in the edit form
  // since they're encrypted) — only include them in the update when a new value was actually
  // typed, so submitting the form without touching them can't null out an existing value.
  const profile = await prisma.partnerProfile.update({
    where: { id: profileId },
    data: {
      region: parsed.region,
      arnCode: parsed.arnCode,
      euinCode: parsed.euinCode,
      ...(parsed.gstin ? { gstin: encryptField(parsed.gstin) } : {}),
      ...(parsed.panNumber ? { panNumber: encryptField(parsed.panNumber) } : {}),
    },
    select: { userId: true },
  });

  revalidatePath(`/settings/users/${profile.userId}`);
}

/** Decrypts a masked field on demand and logs the access — the "Reveal" button's server round-trip. */
export async function revealPartnerFieldAction(profileId: string, field: "panNumber" | "gstin"): Promise<string | null> {
  const session = await requireRole(["ADMIN"]);

  const profile = await prisma.partnerProfile.findUniqueOrThrow({ where: { id: profileId }, select: { panNumber: true, gstin: true } });
  const value = decryptField(profile[field]);

  if (value) {
    await prisma.dataAccessLog.create({
      data: { userId: session.user.id, entity: "PartnerProfile", entityId: profileId, fieldName: field },
    });
  }

  return value;
}

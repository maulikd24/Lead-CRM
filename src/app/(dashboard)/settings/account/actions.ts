"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { requireSession, requireUser } from "@/lib/auth/require-role";
import { signOut } from "@/lib/auth/config";

const updateProfileSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email(),
});

export async function updateOwnProfileAction(formData: FormData) {
  const session = await requireUser();

  const parsed = updateProfileSchema.parse({
    name: formData.get("name"),
    email: formData.get("email"),
  });

  const existing = await prisma.user.findUnique({ where: { email: parsed.email } });
  if (existing && existing.id !== session.user.id) {
    throw new Error("A user with this email already exists");
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { name: parsed.name, email: parsed.email },
  });

  revalidatePath("/settings/account");
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

/** Also the forced-change flow's action (/change-password), so it uses requireSession, not requireUser — which
 * would send a user who must change their password straight back to that page. Ends every session of this user,
 * including the current one, so the caller must send them to /login. */
export async function changeOwnPasswordAction(formData: FormData): Promise<{ signedOut: true }> {
  const session = await requireSession();

  const parsed = changePasswordSchema.parse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id }, omit: { passwordHash: false } });

  const valid = await bcrypt.compare(parsed.currentPassword, user.passwordHash);
  if (!valid) throw new Error("Current password is incorrect");
  // A forced change exists because the old password (or its hash) may be known — reusing it would undo the point.
  if (await bcrypt.compare(parsed.newPassword, user.passwordHash)) {
    throw new Error("Choose a new password, different from your current one");
  }

  const passwordHash = await bcrypt.hash(parsed.newPassword, 10);
  await prisma.user.update({
    where: { id: session.user.id },
    data: { passwordHash, mustChangePassword: false, sessionsValidFrom: new Date() },
  });
  await prisma.auditLog.create({
    data: { userId: session.user.id, entity: "User", entityId: session.user.id, action: "password_changed", newValue: { wasForced: user.mustChangePassword } },
  });

  await signOut({ redirect: false });
  return { signedOut: true };
}

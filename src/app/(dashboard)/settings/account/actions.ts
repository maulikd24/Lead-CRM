"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";

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

export async function changeOwnPasswordAction(formData: FormData) {
  const session = await requireUser();

  const parsed = changePasswordSchema.parse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });

  const valid = await bcrypt.compare(parsed.currentPassword, user.passwordHash);
  if (!valid) throw new Error("Current password is incorrect");

  const passwordHash = await bcrypt.hash(parsed.newPassword, 10);
  await prisma.user.update({ where: { id: session.user.id }, data: { passwordHash } });
}

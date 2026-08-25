"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import type { Role } from "@/generated/prisma/client";

const createUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email(),
  role: z.enum(["ADMIN", "MANAGER", "RM"]),
  managerId: z.string().optional().or(z.literal("")),
  capacity: z.coerce.number().int().positive().optional(),
});

function generateTempPassword(): string {
  return randomBytes(9).toString("base64url"); // 12-char URL-safe temp password
}

export async function createUserAction(formData: FormData) {
  await requireRole(["ADMIN"]);

  const parsed = createUserSchema.parse({
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    managerId: formData.get("managerId"),
    capacity: formData.get("capacity") || undefined,
  });

  const existing = await prisma.user.findUnique({ where: { email: parsed.email } });
  if (existing) throw new Error("A user with this email already exists");

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  await prisma.user.create({
    data: {
      name: parsed.name,
      email: parsed.email,
      role: parsed.role,
      passwordHash,
      managerId: parsed.managerId || null,
      capacity: parsed.capacity ?? null,
    },
  });

  revalidatePath("/settings/users");
  return { tempPassword };
}

export async function setUserRoleAction(userId: string, role: Role) {
  await requireRole(["ADMIN"]);

  await prisma.user.update({ where: { id: userId }, data: { role } });

  revalidatePath("/settings/users");
}

export async function setUserManagerAction(userId: string, managerId: string | null) {
  await requireRole(["ADMIN"]);

  if (managerId === userId) throw new Error("A user cannot be their own manager");

  await prisma.user.update({ where: { id: userId }, data: { managerId } });

  revalidatePath("/settings/users");
}

export async function setUserActiveAction(userId: string, isActive: boolean) {
  const session = await requireRole(["ADMIN"]);

  if (userId === session.user.id && !isActive) {
    throw new Error("You cannot deactivate your own account");
  }

  await prisma.user.update({ where: { id: userId }, data: { isActive } });

  revalidatePath("/settings/users");
}

export async function setUserCapacityAction(userId: string, capacity: number | null) {
  await requireRole(["ADMIN"]);

  await prisma.user.update({ where: { id: userId }, data: { capacity } });

  revalidatePath("/settings/users");
  revalidatePath("/reports");
}

const resetPasswordSchema = z.object({
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

export async function resetUserPasswordAction(userId: string, newPassword: string) {
  await requireRole(["ADMIN"]);

  const parsed = resetPasswordSchema.parse({ newPassword });
  const passwordHash = await bcrypt.hash(parsed.newPassword, 10);

  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

  revalidatePath("/settings/users");
}

"use server";

import { signOut } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}

export async function markTourSeenAction() {
  const session = await requireUser();
  await prisma.user.update({ where: { id: session.user.id }, data: { hasSeenTour: true } });
}

"use server";

import { AuthError } from "next-auth";

import { signIn } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

export type LoginState = { error?: string };

export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { role: true } });
    const redirectTo = user?.role === "DEALER" ? "/dealer-desk" : "/dashboard";
    await signIn("credentials", { email, password, redirectTo });
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Invalid email or password." };
    }
    throw error;
  }
}

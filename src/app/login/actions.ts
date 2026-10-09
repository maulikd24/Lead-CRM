"use server";

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";

import { signIn } from "@/lib/auth/config";
import { safeCallbackUrl, ssoConfigFromEnv } from "@/lib/auth/sso";
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

/** Starts the OpenID Connect flow. Does nothing (back to /login) unless SSO is enabled and fully configured. */
export async function ssoLoginAction(formData: FormData) {
  if (!ssoConfigFromEnv(process.env).enabled) redirect("/login");
  // "/" sends each role to its own landing page; the callback is restricted to same-origin paths.
  await signIn("keycloak", { redirectTo: safeCallbackUrl(formData.get("callbackUrl"), "/") });
}

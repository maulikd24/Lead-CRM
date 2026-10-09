"use server";

import { signOut } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { logUserEvent } from "@/lib/activity/log-user-event";
import { ssoEndSessionUrl } from "@/lib/auth/sso-logout";

export async function logoutAction(formData?: FormData) {
  const session = await requireUser();
  // The Android app sends this phone's push token so a signed-out phone stops getting this user's alerts.
  const pushToken = formData?.get("pushToken");
  if (typeof pushToken === "string" && pushToken) {
    await prisma.pushToken.deleteMany({ where: { token: pushToken, userId: session.user.id } });
  }
  await logUserEvent({
    userId: session.user.id,
    userEmail: session.user.email,
    userRole: session.user.role,
    type: "LOGOUT",
    summary: "Signed out",
  });
  // SSO users also end their identity-provider session; anything missing or failing falls back to a local sign-out.
  const origin = (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
  const providerLogout = origin ? await ssoEndSessionUrl(process.env, `${origin}/login`) : null;
  await signOut({ redirectTo: providerLogout ?? "/login" });
}

export async function markTourSeenAction() {
  const session = await requireUser();
  await prisma.user.update({ where: { id: session.user.id }, data: { hasSeenTour: true } });
}

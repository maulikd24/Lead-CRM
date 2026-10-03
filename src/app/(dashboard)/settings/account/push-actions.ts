"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { NOTIFICATION_CATEGORY_LABELS } from "@/lib/notifications/describe";
import { isPushEnabled, sendPushToUser } from "@/lib/push/send-push";

/**
 * Called by the Android app with its Firebase token. A token belongs to whoever is signed in on that phone,
 * so registering it again under a different user moves it (shared phones never leak one user's alerts to
 * the next).
 */
export async function registerPushTokenAction(token: string) {
  const session = await requireUser();
  if (typeof token !== "string" || token.length < 20 || token.length > 4096) throw new Error("Invalid push token");
  await prisma.pushToken.upsert({
    where: { token },
    update: { userId: session.user.id, lastSeenAt: new Date() },
    create: { token, userId: session.user.id, lastSeenAt: new Date() },
  });
  revalidatePath("/settings/account");
}

/** Sign-out path: stop this phone receiving this user's alerts. Only the owner's own token is removed. */
export async function unregisterPushTokenAction(token: string) {
  const session = await requireUser();
  await prisma.pushToken.deleteMany({ where: { token, userId: session.user.id } });
}

export async function updatePushPreferencesAction(mutedCategories: string[]) {
  const session = await requireUser();
  const valid = new Set(Object.keys(NOTIFICATION_CATEGORY_LABELS));
  const muted = [...new Set(mutedCategories.filter((c) => valid.has(c)))];
  await prisma.user.update({ where: { id: session.user.id }, data: { pushMutedCategories: muted } });
  revalidatePath("/settings/account");
}

/** Lets a user verify the whole chain (server -> Firebase -> phone) on demand. Ignores muted categories. */
export async function sendTestPushAction() {
  const session = await requireUser();
  const devices = await prisma.pushToken.count({ where: { userId: session.user.id } });
  if (devices === 0) return { configured: isPushEnabled(), devices: 0, sent: 0, failed: 0 };
  const result = await sendPushToUser(session.user.id, {
    title: "Supportify test notification",
    body: "If you can read this, phone notifications are working.",
    url: "/settings/account",
  });
  return { configured: isPushEnabled(), devices, ...result };
}

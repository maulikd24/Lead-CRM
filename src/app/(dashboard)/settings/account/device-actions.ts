"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { DEVICE_SYNC_ROLES, generateDeviceToken } from "@/lib/device/token";

const MAX_ACTIVE_DEVICES = 5;

/**
 * Called from inside the Android app after the user consents. Returns the plaintext token exactly once
 * (only its hash is stored) for the native plugin to keep in encrypted storage.
 */
export async function registerDeviceAction(label: string, appVersion?: string) {
  const session = await requireUser();
  if (!DEVICE_SYNC_ROLES.includes(session.user.role)) {
    throw new Error("Call sync is only available for Admins, Managers and RMs");
  }

  const { token, tokenHash } = generateDeviceToken();
  const device = await prisma.deviceToken.create({
    data: { userId: session.user.id, tokenHash, label: label.slice(0, 60) || "Android phone", appVersion: appVersion?.slice(0, 40) },
  });

  // Reinstalls leave orphaned tokens behind — keep the newest MAX_ACTIVE_DEVICES and revoke the rest.
  const active = await prisma.deviceToken.findMany({
    where: { userId: session.user.id, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const stale = active.slice(MAX_ACTIVE_DEVICES).map((d) => d.id);
  if (stale.length > 0) {
    await prisma.deviceToken.updateMany({ where: { id: { in: stale } }, data: { revokedAt: new Date() } });
  }

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      entity: "User",
      entityId: session.user.id,
      action: "device_sync_enabled",
      newValue: { deviceId: device.id, label: device.label },
    },
  });
  revalidatePath("/settings/account");
  return { token, deviceId: device.id };
}

/** A user may disconnect their own device; an Admin may disconnect anyone's. */
export async function revokeDeviceAction(deviceId: string) {
  const session = await requireUser();
  const device = await prisma.deviceToken.findUnique({ where: { id: deviceId } });
  if (!device || device.revokedAt) return;
  if (device.userId !== session.user.id && session.user.role !== "ADMIN") throw new Error("Not allowed");

  await prisma.deviceToken.update({ where: { id: deviceId }, data: { revokedAt: new Date() } });
  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      entity: "User",
      entityId: device.userId,
      action: "device_sync_disabled",
      oldValue: { deviceId, label: device.label },
    },
  });
  revalidatePath("/settings/account");
  revalidatePath(`/settings/users/${device.userId}`);
}

import { createHash, randomBytes } from "node:crypto";

import { prisma } from "@/lib/db/prisma";
import type { Role } from "@/generated/prisma/client";

/** Roles that own clients and may sync a phone's call log. */
export const DEVICE_SYNC_ROLES: Role[] = ["ADMIN", "MANAGER", "RM"];

export function generateDeviceToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashDeviceToken(token) };
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Resolves an `Authorization: Bearer <token>` header to a live device + active user, or null.
 * Revoked tokens, deactivated users and roles outside DEVICE_SYNC_ROLES all fail closed.
 */
export async function authenticateDevice(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([A-Za-z0-9_-]{20,100})$/.exec(header);
  if (!match) return null;

  const device = await prisma.deviceToken.findUnique({
    where: { tokenHash: hashDeviceToken(match[1]) },
    include: { user: { select: { id: true, role: true, isActive: true } } },
  });
  if (!device || device.revokedAt || !device.user.isActive || !DEVICE_SYNC_ROLES.includes(device.user.role)) return null;
  return device;
}

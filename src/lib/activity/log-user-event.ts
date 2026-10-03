import { headers } from "next/headers";

import { basePrisma } from "@/lib/db/prisma";
import type { Role, UserEventType } from "@/generated/prisma/client";
import type { Prisma } from "@/generated/prisma/client";

export type UserEventInput = {
  userId?: string | null;
  userEmail?: string | null;
  userRole?: Role | null;
  type: UserEventType;
  entity?: string;
  entityId?: string | null;
  path?: string;
  summary?: string;
  details?: Prisma.InputJsonValue;
};

/** IP + device of the current request. Returns nulls outside a request (cron, webhooks, seeds). */
export async function getRequestMeta(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    const ipAddress = forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
    return { ipAddress, userAgent: h.get("user-agent")?.slice(0, 400) ?? null };
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}

/**
 * Append one row to the UserEvent feed. Never throws and never blocks the caller on failure — same
 * degrade-gracefully convention as logDataAccess()/recordLoginAttempt(). Uses the un-extended client
 * so logging itself can't trigger the data-change hook.
 */
export async function logUserEvent(input: UserEventInput) {
  try {
    const meta = await getRequestMeta();
    await basePrisma.userEvent.create({
      data: {
        userId: input.userId ?? null,
        userEmail: input.userEmail ?? null,
        userRole: input.userRole ?? null,
        type: input.type,
        entity: input.entity,
        entityId: input.entityId ?? null,
        path: input.path,
        summary: input.summary?.slice(0, 300),
        details: input.details,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    });
  } catch (error) {
    console.error("Failed to record UserEvent", error);
  }
}

/** "Chrome on Android"-style label from a raw user-agent string. Heuristic, display only. */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const os = /Android/i.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/i.test(ua)
      ? "iOS"
      : /Windows/i.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/i.test(ua)
          ? "macOS"
          : /Linux/i.test(ua)
            ? "Linux"
            : "Unknown OS";
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\/|Opera/i.test(ua)
      ? "Opera"
      : /Firefox\//i.test(ua)
        ? "Firefox"
        : /Chrome\//i.test(ua)
          ? "Chrome"
          : /Safari\//i.test(ua)
            ? "Safari"
            : "Browser";
  return `${browser} on ${os}`;
}

/** Records a file download (CSV/PDF) by the signed-in user. */
export async function logExport(
  user: { id: string; email: string; role: Role },
  path: string,
  summary: string,
) {
  await logUserEvent({ userId: user.id, userEmail: user.email, userRole: user.role, type: "EXPORT", path, summary });
}

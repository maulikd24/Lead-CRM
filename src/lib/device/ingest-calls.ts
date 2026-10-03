import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { findClientsByPhoneKeys } from "@/lib/clients/phone-match";
import { normalizePhone } from "@/lib/utils/normalize-contact";

export const MAX_CALLS_PER_REQUEST = 500;
const MAX_AGE_MS = 31 * 24 * 60 * 60 * 1000; // the app backfills at most 30 days
const MAX_FUTURE_MS = 5 * 60 * 1000;

export const callLogPayloadSchema = z.object({
  appVersion: z.string().max(40).optional(),
  calls: z
    .array(
      z.object({
        number: z.string().max(40),
        type: z.string().max(20),
        date: z.number().int().positive(), // epoch ms
        duration: z.number().int().min(0).max(24 * 3600),
      }),
    )
    .max(MAX_CALLS_PER_REQUEST),
});

type Direction = "INCOMING" | "OUTGOING" | "MISSED" | "REJECTED" | "OTHER";

function toDirection(type: string): Direction {
  switch (type.toUpperCase()) {
    case "INCOMING":
      return "INCOMING";
    case "OUTGOING":
      return "OUTGOING";
    case "MISSED":
      return "MISSED";
    case "REJECTED":
      return "REJECTED";
    default:
      return "OTHER";
  }
}

const LABEL: Record<Direction, string> = {
  INCOMING: "Incoming call",
  OUTGOING: "Outgoing call",
  MISSED: "Missed call",
  REJECTED: "Rejected call",
  OTHER: "Call",
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

export type IngestResult = { matched: number; duplicates: number; ignored: number };

/**
 * Maps a phone's call log onto the caller's clients. Only calls whose number matches a client inside the
 * caller's visible scope become Activity rows; every other call is counted and dropped — never stored or logged.
 */
export async function ingestDeviceCalls(
  device: { id: string; userId: string },
  user: { id: string; role: Role },
  payload: z.infer<typeof callLogPayloadSchema>,
  now = new Date(),
): Promise<IngestResult> {
  const nowMs = now.getTime();
  const usable = payload.calls
    .filter((c) => c.date <= nowMs + MAX_FUTURE_MS && c.date >= nowMs - MAX_AGE_MS)
    .map((c) => ({ ...c, key: normalizePhone(c.number).slice(-10) }))
    .filter((c) => c.key.length >= 7); // drops private/unknown/short numbers
  let ignored = payload.calls.length - usable.length;

  const visibleUserIds = await getVisibleUserIds(user.id, user.role);
  const clientByKey = await findClientsByPhoneKeys([...new Set(usable.map((c) => c.key))], visibleUserIds);

  let matched = 0;
  let duplicates = 0;
  for (const call of usable) {
    const clientId = clientByKey.get(call.key);
    if (!clientId) {
      ignored += 1;
      continue;
    }
    const direction = toDirection(call.type);
    const durationSeconds = direction === "MISSED" || direction === "REJECTED" ? 0 : call.duration;
    const startedAt = new Date(call.date);
    try {
      await prisma.$transaction(async (tx) => {
        const activity = await tx.activity.create({
          data: {
            clientId,
            userId: user.id,
            type: "CALL",
            createdAt: startedAt,
            payload: {
              source: "device",
              direction,
              status: direction.toLowerCase(),
              durationSeconds,
              message: `${LABEL[direction]}${durationSeconds > 0 ? ` · ${formatDuration(durationSeconds)}` : ""} (from phone)`,
            },
          },
        });
        await tx.deviceCall.create({
          data: { userId: user.id, clientId, deviceTokenId: device.id, activityId: activity.id, phoneKey: call.key, direction, startedAt, durationSeconds },
        });
      });
      matched += 1;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        duplicates += 1; // already synced (re-sync / reinstall) — the transaction rolled the Activity back
        continue;
      }
      throw error;
    }
  }

  await prisma.deviceToken.update({
    where: { id: device.id },
    data: { lastSeenAt: now, lastSyncAt: now, lastSyncMatched: matched, ...(payload.appVersion ? { appVersion: payload.appVersion } : {}) },
  });
  return { matched, duplicates, ignored };
}

import { prisma } from "@/lib/db/prisma";
import { normalizePhone } from "@/lib/utils/normalize-contact";

const DEFAULT_COUNTRY_CODE = process.env.WHATSAPP_DEFAULT_COUNTRY_CODE ?? "91";

export type ParsedChat =
  | { kind: "individual"; digits: string; key: string }
  | { kind: "ignored"; reason: "group" | "broadcast" | "newsletter" | "lid" | "unknown" };

/**
 * Classifies a WhatsApp chat id. Only 1:1 chats with a real phone number are usable —
 * groups, status broadcasts, channels and privacy-masked @lid ids cannot be matched to a client.
 * `key` is the last 10 digits (same cross-format matching idea as normalizePhone/checkDuplicate).
 */
export function parseChatId(chatId: string): ParsedChat {
  if (chatId.endsWith("@g.us")) return { kind: "ignored", reason: "group" };
  if (chatId === "status@broadcast" || chatId.endsWith("@broadcast")) return { kind: "ignored", reason: "broadcast" };
  if (chatId.endsWith("@newsletter")) return { kind: "ignored", reason: "newsletter" };
  if (chatId.endsWith("@lid")) return { kind: "ignored", reason: "lid" };

  const match = /^(\d{7,15})@(c\.us|s\.whatsapp\.net)$/.exec(chatId);
  if (!match) return { kind: "ignored", reason: "unknown" };

  const digits = match[1];
  return { kind: "individual", digits, key: digits.slice(-10) };
}

/** Value to store as Client.mobile for a brand-new lead — same canonical form checkDuplicateClientAction compares. */
export function mobileForNewLead(digits: string): string {
  return normalizePhone(digits);
}

/** Fallback chat id when no WhatsApp message has ever carried one (10-digit numbers get the default country code). */
export function deriveChatId(mobile: string): string | null {
  const digits = mobile.replace(/\D/g, "");
  if (digits.length < 7) return null;
  const full = digits.length === 10 ? `${DEFAULT_COUNTRY_CODE}${digits}` : digits;
  return `${full}@c.us`;
}

/**
 * Cross-format phone lookup (stored values are never normalized in this schema, so this compares
 * digits-only, last 10). Excludes archived/merged clients. Scans at current scale — the same
 * precedent as checkDuplicateClientAction; add a stored normalized column if the table grows large.
 */
export async function findClientByPhoneKey(key: string) {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Client"
    WHERE "isDeleted" = false
      AND "mergedIntoId" IS NULL
      AND mobile IS NOT NULL
      AND right(regexp_replace(mobile, '[^0-9]', '', 'g'), 10) = ${key}
    ORDER BY "createdAt" ASC
    LIMIT 1`;
  if (rows.length === 0) return null;
  return prisma.client.findUnique({
    where: { id: rows[0].id },
    select: { id: true, name: true, assignedToId: true },
  });
}

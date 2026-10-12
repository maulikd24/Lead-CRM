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

/** The client for a phone, by the shared identity key (src/lib/clients/identity-keys.ts) — the same rule every lead
 * source uses, via an index. Excludes archived/merged clients; the earliest-created wins if two share a number. */
export async function findClientByPhoneKey(key: string | null) {
  if (!key) return null;
  return prisma.client.findFirst({
    where: { mobileKey: key, isDeleted: false, mergedIntoId: null },
    select: { id: true, name: true, assignedToId: true },
    orderBy: { createdAt: "asc" },
  });
}

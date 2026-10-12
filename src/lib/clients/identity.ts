import { prisma } from "@/lib/db/prisma";
import type { ClientStatus } from "@/generated/prisma/client";

// Pure key functions live in ./identity-keys so the Prisma client's key-syncing extension can use them without an
// import cycle (this module itself queries through that client).
import { emailKey, phoneKey } from "./identity-keys";
export { emailKey, phoneKey };

type MatchedClient = { id: string; name: string; status: ClientStatus; assignedToId: string | null; mobile: string | null; email: string | null };

const CLIENT_SELECT = { id: true, name: true, status: true, assignedToId: true, mobile: true, email: true } as const;
const LIVE_CLIENT = { isDeleted: false, mergedIntoId: null } as const;

/** Earliest-created live client whose own contact — or an active joint holder's — has this key. */
async function findByKey(field: "mobileKey" | "emailKey", key: string): Promise<MatchedClient | null> {
  const [own, viaHolder] = await Promise.all([
    prisma.client.findFirst({ where: { ...LIVE_CLIENT, [field]: key }, select: { ...CLIENT_SELECT, createdAt: true }, orderBy: { createdAt: "asc" } }),
    prisma.accountHolder.findFirst({
      where: { isDeleted: false, [field]: key, client: LIVE_CLIENT },
      select: { client: { select: { ...CLIENT_SELECT, createdAt: true } } },
      orderBy: { client: { createdAt: "asc" } },
    }),
  ]);
  const candidates = [own, viaHolder?.client].filter((c): c is MatchedClient & { createdAt: Date } => !!c);
  candidates.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const first = candidates[0];
  if (!first) return null;
  return { id: first.id, name: first.name, status: first.status, assignedToId: first.assignedToId, mobile: first.mobile, email: first.email };
}

/**
 * Who is this contact? Phone is the stronger identifier: when phone and email point at different clients the phone
 * match is the answer and `conflict` is true. Includes "Not proceeding" clients — a returning person keeps one
 * profile — and excludes archived/merged ones.
 */
export async function findClientByIdentity(input: { phone?: string | null; email?: string | null }) {
  const pKey = phoneKey(input.phone);
  const eKey = emailKey(input.email);
  const [phoneMatch, emailMatch] = await Promise.all([
    pKey ? findByKey("mobileKey", pKey) : Promise.resolve(null),
    eKey ? findByKey("emailKey", eKey) : Promise.resolve(null),
  ]);
  const match = phoneMatch ?? emailMatch;
  return { match, phoneMatch, emailMatch, conflict: !!phoneMatch && !!emailMatch && phoneMatch.id !== emailMatch.id };
}

/** Freshdesk/back-office lookups need the formats a phone is commonly stored in elsewhere. */
export function phoneVariants(raw: string | null | undefined): string[] {
  const key = phoneKey(raw);
  if (!key) return [];
  return key.length === 10 ? [key, `+91${key}`, `91${key}`, `0${key}`, `+91 ${key}`] : [key, `+${key}`];
}

/**
 * The CleverTap Identity is the app user id (the identity provider's user id), never an email or a mobile number.
 * The app-signup webhook files every signup in the LeadIntake ledger as (source "allvest_app", externalId = app user id,
 * clientId = the customer it landed on, whether that customer was new or already known), so the ledger is where the id is
 * read from. A customer with no such row is not an app user and is never written to CleverTap.
 */
export const APP_SIGNUP_SOURCE = "allvest_app";

const MAX_ID = 200;

export type AppUserIdResult = { identity: string; reason?: undefined } | { identity: null; reason: string };

/** Pure. Same rows in, same identity out; skips (with a reason) rather than guessing. */
export function resolveAppUserId(rows: { externalId: string }[]): AppUserIdResult {
  const ids = [...new Set(rows.map((r) => r.externalId.trim()).filter((id) => id.length > 0 && id.length <= MAX_ID))];
  if (ids.length === 0) return { identity: null, reason: "customer has no app user id" };
  if (ids.length > 1) return { identity: null, reason: "customer is linked to more than one app user id; not guessing" };
  return { identity: ids[0] };
}

/** Structural so tests can inject a fake and Prisma's client satisfies it. */
export type IdentityDb = {
  leadIntake: {
    findMany(args: {
      where: { source: string; clientId: string; status: { in: ("CREATED" | "DUPLICATE")[] } };
      select: { externalId: true };
      orderBy: { receivedAt: "asc" };
      take: number;
    }): Promise<{ externalId: string }[]>;
  };
};

export async function loadAppUserId(db: IdentityDb, clientId: string): Promise<AppUserIdResult> {
  const rows = await db.leadIntake.findMany({
    where: { source: APP_SIGNUP_SOURCE, clientId, status: { in: ["CREATED", "DUPLICATE"] } },
    select: { externalId: true },
    orderBy: { receivedAt: "asc" },
    take: 5,
  });
  return resolveAppUserId(rows);
}

/**
 * Master switch for everything that links customers to their app user id beyond the push itself: matching inbound
 * CleverTap events by app user id, re-pointing the ledger when two customers are merged, and the backfill write.
 * Off unless the value is exactly "1".
 */
export function appIdLinkingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.APP_USER_ID_LINKING === "1";
}

export type FindByAppIdDb = {
  leadIntake: {
    findUnique(args: {
      where: { source_externalId: { source: string; externalId: string } };
      select: { clientId: true; status: true };
    }): Promise<{ clientId: string | null; status: string } | null>;
  };
};

/** The customer an app user id landed on, read from the signup ledger by its unique key. Null when unknown. */
export async function findClientIdByAppUserId(db: FindByAppIdDb, appUserId: string): Promise<string | null> {
  const externalId = appUserId.trim();
  if (!externalId || externalId.length > MAX_ID) return null;
  const row = await db.leadIntake.findUnique({
    where: { source_externalId: { source: APP_SIGNUP_SOURCE, externalId } },
    select: { clientId: true, status: true },
  });
  if (!row || !row.clientId || (row.status !== "CREATED" && row.status !== "DUPLICATE")) return null;
  return row.clientId;
}

export type LiveClientDb = {
  client: { findUnique(args: { where: { id: string }; select: { mergedIntoId: true; isDeleted: true } }): Promise<{ mergedIntoId: string | null; isDeleted: boolean } | null> };
};

/** Follows "merged into" links to the surviving customer. Null when it (or the survivor) is deleted or missing, or the chain loops. */
export async function resolveLiveClientId(db: LiveClientDb, clientId: string): Promise<string | null> {
  const seen = new Set<string>();
  let id = clientId;
  for (let hops = 0; hops < 8; hops++) {
    if (seen.has(id)) return null;
    seen.add(id);
    const c = await db.client.findUnique({ where: { id }, select: { mergedIntoId: true, isDeleted: true } });
    if (!c || c.isDeleted) return null;
    if (!c.mergedIntoId) return id;
    id = c.mergedIntoId;
  }
  return null;
}

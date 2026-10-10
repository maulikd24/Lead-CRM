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

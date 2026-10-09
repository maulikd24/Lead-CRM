import type { Prisma } from "@/generated/prisma/client";
const HAS = (field: "email" | "mobile") => ({ AND: [{ [field]: { not: null } }, { NOT: { [field]: "" } }] });

/** The one query shape this helper issues; kept structural so tests can fake it and Prisma's client satisfies it. */
export type SelectArgs = {
  where: { status: "ACTIVE"; isDeleted: false; mergedIntoId: null; OR: Prisma.ClientWhereInput[]; AND?: Prisma.ClientWhereInput[] };
  orderBy: [{ cleverTapSync: { lastCheckedAt: { sort: "asc"; nulls: "first" } } }, { createdAt: "asc" }];
  take: number;
  select: { id: true };
};

export type SelectDb = { client: { findMany(args: SelectArgs): Promise<{ id: string }[]> } };

/**
 * Picks the next customers to evaluate: ACTIVE, live, with an email or mobile, never-checked first (oldest first),
 * then least recently checked. One query: a customer with no ledger row sorts as null, which is first.
 */
export async function selectBatch(db: SelectDb, limit: number, extraWhere?: Prisma.ClientWhereInput): Promise<string[]> {
  const rows = await db.client.findMany({
    where: { status: "ACTIVE", isDeleted: false, mergedIntoId: null, OR: [HAS("email"), HAS("mobile")], ...(extraWhere ? { AND: [extraWhere] } : {}) },
    orderBy: [{ cleverTapSync: { lastCheckedAt: { sort: "asc", nulls: "first" } } }, { createdAt: "asc" }],
    take: limit,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

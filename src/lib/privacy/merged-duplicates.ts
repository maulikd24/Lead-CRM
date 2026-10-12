import { Prisma } from "@/generated/prisma/client";
import type { prisma } from "@/lib/db/prisma";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type MergedDuplicate = { id: string; clientCode: string; mobile: string | null; email: string | null; mergedIntoId: string | null };

const MAX_DEPTH = 8;
const MAX_ROWS = 500;

/**
 * Every Client row that was merged INTO this customer, directly or through a chain of merges (a duplicate of a duplicate).
 * A merge never deletes the duplicate: it keeps the same person's name, phone, email and PAN, so erasing the survivor has to reach
 * these rows too. Iterative with a depth and size cap, so a looping or runaway chain cannot hang the transaction.
 */
export async function findMergedDuplicates(tx: Tx, survivorId: string): Promise<MergedDuplicate[]> {
  const found = new Map<string, MergedDuplicate>();
  let frontier = [survivorId];
  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0 && found.size < MAX_ROWS; depth++) {
    const rows = await tx.client.findMany({
      where: { mergedIntoId: { in: frontier } },
      select: { id: true, clientCode: true, mobile: true, email: true, mergedIntoId: true },
    });
    frontier = [];
    for (const row of rows) {
      if (row.id === survivorId || found.has(row.id)) continue;
      found.set(row.id, row);
      frontier.push(row.id);
    }
  }
  return [...found.values()];
}

export const ERASED_NAME = "Erased customer";

/**
 * Scrubs every personal field of a merged-away duplicate. The row stays (its id and client code anchor the append-only audit
 * trail, and mergedIntoId keeps it out of every list) but holds nothing about the person any more.
 */
export async function scrubMergedDuplicate(tx: Tx, id: string): Promise<void> {
  await tx.client.update({
    where: { id },
    data: {
      name: ERASED_NAME,
      mobile: null,
      email: null,
      mobileKey: null,
      emailKey: null,
      pan: null,
      ckycRef: null,
      region: null,
      city: null,
      state: null,
      notes: null,
      leadAttribution: Prisma.DbNull,
      marketingConsentAt: null,
      marketingConsentText: null,
      productInterest: null,
      existingBroker: null,
      tradingExperience: null,
      expectedInvestment: null,
      referralSource: null,
      freshdeskSyncedAt: null,
      freshdeskSyncKey: null,
      nextActionTitle: null,
    },
  });
}

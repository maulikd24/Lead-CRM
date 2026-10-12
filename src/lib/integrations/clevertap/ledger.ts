/** The CleverTapSync ledger. `lastHash` is NOT NULL, so "" means "never successfully pushed". */
export type LedgerDb = {
  cleverTapSync: {
    findUnique(args: { where: { clientId: string }; select: { lastHash: true } }): Promise<{ lastHash: string } | null>;
    upsert(args: {
      where: { clientId: string };
      create: { clientId: string; lastHash: string; lastError?: string | null; lastCheckedAt?: Date };
      update: { lastHash?: string; lastPushedAt?: Date; lastError?: string | null; lastCheckedAt?: Date };
    }): Promise<unknown>;
  };
};

const MAX_ERROR = 500;

export async function getLastHash(db: LedgerDb, clientId: string): Promise<string | null> {
  const row = await db.cleverTapSync.findUnique({ where: { clientId }, select: { lastHash: true } });
  return row?.lastHash ? row.lastHash : null;
}

export async function recordSuccess(db: LedgerDb, clientId: string, hash: string): Promise<void> {
  await db.cleverTapSync.upsert({
    where: { clientId },
    create: { clientId, lastHash: hash, lastError: null },
    update: { lastHash: hash, lastPushedAt: new Date(), lastError: null },
  });
}

/** Records only the error. An existing row keeps its lastHash and lastPushedAt. */
export async function recordFailure(db: LedgerDb, clientId: string, message: string): Promise<void> {
  const lastError = message.slice(0, MAX_ERROR);
  await db.cleverTapSync.upsert({
    where: { clientId },
    create: { clientId, lastHash: "", lastError },
    update: { lastError },
  });
}

/** Marks the customer as evaluated now (batch rotation). Never touches lastHash, lastPushedAt or lastError on an existing row. */
export async function recordChecked(db: LedgerDb, clientId: string, at: Date = new Date()): Promise<void> {
  await db.cleverTapSync.upsert({
    where: { clientId },
    create: { clientId, lastHash: "", lastCheckedAt: at },
    update: { lastCheckedAt: at },
  });
}

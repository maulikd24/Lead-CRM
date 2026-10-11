import { prisma } from "@/lib/db/prisma";

import { pruneJobRuns, type PruneRule, type RetentionStore } from "./job-retention";

export const retentionStore: RetentionStore = {
  deleteRuns: async (rule: PruneRule, limit: number) =>
    prisma.$executeRaw`
      DELETE FROM "JobRun" WHERE "id" IN (
        SELECT r."id" FROM "JobRun" r
        WHERE r."status" = ANY(${rule.statuses}) AND (${rule.kinds ?? null}::text[] IS NULL OR r."kind" = ANY(${rule.kinds ?? []}))
          AND r."startedAt" < ${rule.olderThan}
          AND EXISTS (SELECT 1 FROM "JobRun" n WHERE n."job" = r."job" AND n."startedAt" > r."startedAt")
        ORDER BY r."startedAt" ASC
        LIMIT ${limit}
      )`,
  deleteResolvedAlerts: async (olderThan, limit) =>
    prisma.$executeRaw`DELETE FROM "ControlPlaneAlert" WHERE "id" IN (SELECT "id" FROM "ControlPlaneAlert" WHERE "resolvedAt" IS NOT NULL AND "resolvedAt" < ${olderThan} LIMIT ${limit})`,
};

/** Cron job "pruneJobRuns". */
export const runPruneJobRuns = (now = new Date()) => pruneJobRuns(retentionStore, now);

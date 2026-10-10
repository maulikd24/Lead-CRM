import { readdir } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/db/prisma";
import { pilotDb } from "@/lib/agents/pilot-wiring";
import { CRON_HEARTBEAT } from "./heartbeat-constants";
import { getHeartbeatAgeMs } from "./heartbeat";
import type { StatusDeps } from "./status";
import type { TickDb } from "./cutover-checks";

const DAY = 86_400_000;

/** Real data for the Admin system status. Read-only. */
export const statusDeps: StatusDeps = {
  ping: async () => {
    const r = await prisma.$queryRaw<{ name: string; v: string }[]>`SELECT current_database() AS name, current_setting('server_version') AS v`;
    return { database: r[0].name, serverVersion: r[0].v };
  },
  migrations: async () => {
    const rows = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`;
    return {
      applied: rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name),
      failed: rows.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name),
    };
  },
  migrationsOnDisk: async () => {
    try {
      return (await readdir(path.join(process.cwd(), "prisma", "migrations"), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return null;
    }
  },
  heartbeatAgeMs: () => getHeartbeatAgeMs(CRON_HEARTBEAT),
  dailyJobs: async () => {
    const [daily, ads, imports] = await Promise.all([
      prisma.dailyJobRun.groupBy({ by: ["jobName"], _max: { createdAt: true } }),
      prisma.adSyncRun.groupBy({ by: ["provider"], _max: { startedAt: true } }),
      prisma.backOfficeImportRun.aggregate({ _max: { startedAt: true } }),
    ]);
    return [
      ...daily.flatMap((d) => (d._max.createdAt ? [{ name: d.jobName, at: d._max.createdAt }] : [])),
      ...ads.flatMap((a) => (a._max.startedAt ? [{ name: `ad_sync:${a.provider}`, at: a._max.startedAt }] : [])),
      ...(imports._max.startedAt ? [{ name: "backoffice_import", at: imports._max.startedAt }] : []),
    ].sort((a, b) => a.name.localeCompare(b.name));
  },
  queueFacts: async () => {
    const now = new Date();
    const [wa, drafts, leadErrors7d, reviews, mergeOpen] = await Promise.all([
      prisma.message.aggregate({ where: { status: "QUEUED", accountId: { not: null } }, _count: { _all: true }, _min: { createdAt: true } }),
      prisma.agentProposal.aggregate({ where: { status: "DRAFT", expiresAt: { gt: now }, agentKey: { not: "wa_reply" } }, _count: { _all: true }, _min: { createdAt: true } }),
      prisma.leadIntake.count({ where: { status: "ERROR", receivedAt: { gte: new Date(now.getTime() - 7 * DAY) } } }),
      prisma.conversationReview.aggregate({ where: { status: { in: ["PENDING_TRANSCRIPT", "ANALYZING"] } }, _count: { _all: true }, _min: { createdAt: true } }),
      prisma.mergeSuggestion.count({ where: { status: "OPEN" } }),
    ]);
    return {
      whatsappQueued: { n: wa._count._all, oldest: wa._min.createdAt },
      draftsWaiting: { n: drafts._count._all, oldest: drafts._min.createdAt },
      leadErrors7d,
      reviewsBacklog: { n: reviews._count._all, oldest: reviews._min.createdAt },
      mergeOpen,
    };
  },
  // The encrypted blob itself is never selected: only whether one exists.
  integrationRows: async () => {
    const rows = await prisma.$queryRaw<{ provider: string; mode: string; isEnabled: boolean; has: boolean; updatedAt: Date }[]>`SELECT provider, mode, "isEnabled", (credentials IS NOT NULL) AS has, "updatedAt" FROM "IntegrationConfig"`;
    return rows.map((r) => ({ provider: r.provider, mode: r.mode, isEnabled: r.isEnabled, hasCredentials: r.has, updatedAt: r.updatedAt }));
  },
  aiKeySaved: async () => (await pilotDb.aiKeyMeta()) !== null,
};


export const tickDb: TickDb = {
  upsert: async (itemId, v) => {
    await prisma.goLiveCheck.upsert({ where: { itemId }, create: { itemId, ...v }, update: v });
  },
  audit: async (e) => {
    await prisma.auditLog.create({ data: { userId: e.userId, entity: e.entity, entityId: e.entityId, action: e.action, reason: e.reason } });
  },
};

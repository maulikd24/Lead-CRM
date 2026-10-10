import { logUserEvent } from "@/lib/activity/log-user-event";
import { prisma } from "@/lib/db/prisma";
import { lookupCustomers, prismaFeedRepo } from "@/lib/portfolio-feed/prisma-repo";
import type { Prisma } from "@/generated/prisma/client";

import { DEFAULT_MAPPING, parseMapping, type BackOfficeMapping, type FileKind, type MappingIssue } from "./mapping";
import type { ClientProfile, ClientRepo, RunAudit, RunDeps, RunsRepo } from "./runner";

const CONFIG_ID = "default";
/** A RUNNING row older than this is treated as crashed and no longer blocks a retry. */
const RUNNING_STALE_MS = 15 * 60 * 1000;

/** The stored mapping, or the documented default when none is stored (or the stored one no longer validates). */
export async function loadMapping(): Promise<BackOfficeMapping> {
  const row = await prisma.backOfficeImportConfig.findUnique({ where: { id: CONFIG_ID } });
  if (!row) return DEFAULT_MAPPING;
  const parsed = parseMapping(row.mapping);
  return parsed.ok ? parsed.mapping : DEFAULT_MAPPING;
}

export async function saveMapping(input: unknown, userId: string): Promise<{ ok: true } | { ok: false; issues: MappingIssue[] }> {
  const parsed = parseMapping(input);
  if (!parsed.ok) return parsed;
  const mapping = parsed.mapping as unknown as Prisma.InputJsonValue;
  await prisma.backOfficeImportConfig.upsert({ where: { id: CONFIG_ID }, create: { id: CONFIG_ID, mapping, updatedById: userId }, update: { mapping, updatedById: userId } });
  await logUserEvent({ userId, type: "DATA_UPDATE", entity: "BackOfficeImportConfig", entityId: CONFIG_ID, summary: "Back-office import column mapping updated" });
  return { ok: true };
}

export const prismaRunsRepo: RunsRepo = {
  async hasCompleted(checksum, kind) {
    return (await prisma.backOfficeImportRun.count({ where: { checksum, kind, dryRun: false, status: { in: ["SUCCESS", "PARTIAL"] } } })) > 0;
  },
  async hasRunning(checksum, kind) {
    return (await prisma.backOfficeImportRun.count({ where: { checksum, kind, dryRun: false, status: "RUNNING", startedAt: { gte: new Date(Date.now() - RUNNING_STALE_MS) } } })) > 0;
  },
  async start(input) {
    const row = await prisma.backOfficeImportRun.create({ data: { ...input, status: "RUNNING" }, select: { id: true, seq: true } });
    return { id: row.id, seq: row.seq };
  },
  async finish(id, result) {
    await prisma.backOfficeImportRun.update({
      where: { id },
      data: { status: result.status, counts: (result.counts ?? undefined) as Prisma.InputJsonValue | undefined, errors: (result.errors ?? undefined) as Prisma.InputJsonValue | undefined, finishedAt: new Date() },
    });
  },
};

export async function cronRanSince(since: Date): Promise<boolean> {
  return (await prisma.backOfficeImportRun.count({ where: { trigger: "CRON", startedAt: { gte: since } } })) > 0;
}

const SELECT = { id: true, name: true, email: true, mobile: true, city: true, state: true, clientType: true, investmentCategory: true } as const;
export const prismaClientRepo: ClientRepo = {
  async getProfiles(ids) {
    const rows = ids.length ? await prisma.client.findMany({ where: { id: { in: ids } }, select: SELECT }) : [];
    return new Map(rows.map(({ id, ...profile }): [string, ClientProfile] => [id, profile]));
  },
  async update(id, data) {
    await prisma.client.update({ where: { id }, data });
  },
};

/** Audit record in the existing user-event log: counts only, never file names' contents, identifiers or values. */
export async function auditRun(a: RunAudit): Promise<void> {
  await logUserEvent({
    userId: a.userId,
    type: "DATA_UPDATE",
    entity: "BackOfficeImport",
    entityId: a.runId,
    summary: `Back-office import (${a.kind.toLowerCase()}${a.dryRun ? ", dry run" : ""}, ${a.trigger.toLowerCase()}): ${a.status.toLowerCase()}`,
    details: { kind: a.kind, dryRun: a.dryRun, trigger: a.trigger, status: a.status, errorCount: a.errorCount, counts: a.counts as Prisma.InputJsonValue },
  });
}

export function prismaRunDeps(): RunDeps {
  return { lookup: lookupCustomers, feedRepo: prismaFeedRepo, clientRepo: prismaClientRepo, runs: prismaRunsRepo, audit: auditRun };
}

export type LastRun = { id: string; kind: FileKind; fileName: string; dryRun: boolean; trigger: string; status: string; counts: unknown; errors: unknown; startedAt: Date; finishedAt: Date | null };
export async function loadRecentRuns(take = 10): Promise<LastRun[]> {
  const rows = await prisma.backOfficeImportRun.findMany({ orderBy: { startedAt: "desc" }, take, select: { id: true, kind: true, fileName: true, dryRun: true, trigger: true, status: true, counts: true, errors: true, startedAt: true, finishedAt: true } });
  return rows.map((r) => ({ ...r, kind: r.kind as FileKind }));
}

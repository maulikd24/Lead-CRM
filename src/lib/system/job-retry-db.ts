import { prisma } from "@/lib/db/prisma";

import { CRON_TICK_LOCK, claimLease, releaseLease } from "./heartbeat";
import type { RetryDeps } from "./job-retry";
import { jobRunStore } from "./job-run-db";
import { JOB_RUNNERS } from "./job-runners";

const LEASE_MS = 300_000;

/** Real wiring of the Admin retry: the tick's own lease, the real store, an AuditLog row (entity ids only). */
export const retryDeps: RetryDeps = {
  findRun: async (id) => {
    const r = await prisma.jobRun.findUnique({ where: { id }, select: { id: true, job: true, status: true, attempt: true } });
    return r;
  },
  latestStatus: async (job) => (await prisma.jobRun.findFirst({ where: { job, status: { not: "RUNNING" } }, orderBy: { startedAt: "desc" }, select: { status: true } }))?.status ?? null,
  claimLease: () => claimLease(CRON_TICK_LOCK, LEASE_MS),
  releaseLease: () => releaseLease(CRON_TICK_LOCK),
  runners: JOB_RUNNERS,
  store: jobRunStore,
  audit: async (e) => { await prisma.auditLog.create({ data: { userId: e.userId, entity: e.entity, entityId: e.entityId, action: e.action, reason: e.reason } }); },
};

import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";

import type { RunRow, RunStore } from "./job-run";

const data = (r: RunRow) => ({ ...r, summary: (r.summary ?? undefined) as Prisma.InputJsonValue | undefined });

/** The real store behind the recorder. Plain inserts and one update by primary key: no read, no lock, no join. */
export const jobRunStore: RunStore = {
  insert: async (row) => { await prisma.jobRun.create({ data: data(row) }); },
  update: async (id, patch) => { await prisma.jobRun.update({ where: { id }, data: { ...patch, summary: (patch.summary ?? undefined) as Prisma.InputJsonValue | undefined } }); },
  createMany: async (rows) => { await prisma.jobRun.createMany({ data: rows.map(data) }); },
};

/** A tick that is still RUNNING long after its lease expired was killed (function limit): mark it ABANDONED so the page can say so. */
export async function abandonStaleTicks(now: Date, leaseMs: number): Promise<number> {
  const cutoff = new Date(now.getTime() - leaseMs - 60_000);
  const r = await prisma.jobRun.updateMany({ where: { job: "__tick", status: "RUNNING", startedAt: { lt: cutoff } }, data: { status: "ABANDONED", finishedAt: now } });
  return r.count;
}

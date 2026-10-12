import { basePrisma } from "@/lib/db/prisma";

import type { AdRowInput, CreativeRowInput, SyncHistory } from "./sync-core";

/** Database writes shared by every channel's sync. Rows are upserted by their natural keys, so repeating a run changes nothing. */

const CHUNK = 100;

export async function upsertAdRows(rows: AdRowInput[]): Promise<number> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await basePrisma.$transaction(
      chunk.map((r) => {
        const { provider, accountId, campaignId, date, ...rest } = r;
        return basePrisma.adCampaignDaily.upsert({
          where: { provider_accountId_campaignId_date: { provider, accountId, campaignId, date } },
          create: r,
          update: rest,
        });
      }),
    );
  }
  return rows.length;
}

export async function upsertCreativeRows(rows: CreativeRowInput[]): Promise<number> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await basePrisma.$transaction(
      chunk.map((r) => {
        const { provider, accountId, adId, date, ...rest } = r;
        return basePrisma.adCreativeDaily.upsert({
          where: { provider_accountId_adId_date: { provider, accountId, adId, date } },
          create: r,
          update: rest,
        });
      }),
    );
  }
  return rows.length;
}

export async function adSyncHistory(provider: string, accountId: string): Promise<SyncHistory> {
  const latest = (where: object) => basePrisma.adSyncRun.findFirst({ where: { provider, accountId, ...where }, orderBy: { startedAt: "desc" }, select: { startedAt: true } });
  const [attempt, success, limited] = await Promise.all([latest({ status: { not: "RATE_LIMITED" } }), latest({ status: "SUCCESS" }), latest({ status: "RATE_LIMITED" })]);
  return { lastAttemptAt: attempt?.startedAt ?? null, lastSuccessAt: success?.startedAt ?? null, lastRateLimitedAt: limited?.startedAt ?? null };
}

/** A setup problem leaves a FAILED run for the page to show, at most once per interval so a 5-minute tick does not fill the ledger. */
export async function recordSetupFailure(provider: string, accountId: string | null, message: string, now: Date, minIntervalHours: number): Promise<{ status: "FAILED"; rowsUpserted: 0; windowsOk: 0; windowsFailed: 0; error: string }> {
  try {
    const since = new Date(now.getTime() - minIntervalHours * 3_600_000);
    const recent = await basePrisma.adSyncRun.findFirst({ where: { provider, accountId, status: "FAILED", error: message, startedAt: { gt: since } }, select: { id: true } });
    if (!recent) await basePrisma.adSyncRun.create({ data: { provider, accountId, status: "FAILED", error: message, startedAt: now, finishedAt: now } });
  } catch {
    console.error("Ad sync: could not record a setup failure");
  }
  return { status: "FAILED", rowsUpserted: 0, windowsOk: 0, windowsFailed: 0, error: message };
}

export async function recordRun(run: {
  provider: string;
  accountId: string;
  windowStart: string | null;
  windowEnd: string | null;
  status: string;
  error: string | null;
  rowsUpserted: number;
  campaignsSeen: number;
  windowsOk: number;
  windowsFailed: number;
  startedAt: Date;
  finishedAt: Date;
}): Promise<void> {
  await basePrisma.adSyncRun.create({
    data: { ...run, windowStart: run.windowStart ? new Date(`${run.windowStart}T00:00:00.000Z`) : null, windowEnd: run.windowEnd ? new Date(`${run.windowEnd}T00:00:00.000Z`) : null },
  });
}

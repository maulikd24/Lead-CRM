import { basePrisma } from "@/lib/db/prisma";

import { getMetaAdsConfig, metaAdsSyncEnabled } from "./config";
import { createMetaAdsClient } from "./meta-ads";
import { AD_PROVIDER, DEFAULT_SYNC_OPTIONS, runMetaAdsSync, type AdRowInput, type SyncHistory, type SyncOptions, type SyncResult } from "./sync-core";

export type MetaSyncOutcome = SyncResult | { status: "DISABLED" } | { status: "NOT_CONFIGURED" };

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function syncOptionsFromEnv(): SyncOptions {
  return { ...DEFAULT_SYNC_OPTIONS, minIntervalHours: intFromEnv("META_ADS_SYNC_EVERY_HOURS", DEFAULT_SYNC_OPTIONS.minIntervalHours, 1, 168) };
}

const CHUNK = 100;

async function upsertRows(rows: AdRowInput[]): Promise<number> {
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

async function history(accountId: string): Promise<SyncHistory> {
  const latest = (where: object) => basePrisma.adSyncRun.findFirst({ where: { provider: AD_PROVIDER, accountId, ...where }, orderBy: { startedAt: "desc" }, select: { startedAt: true } });
  const [attempt, success, limited] = await Promise.all([latest({ status: { not: "RATE_LIMITED" } }), latest({ status: "SUCCESS" }), latest({ status: "RATE_LIMITED" })]);
  return { lastAttemptAt: attempt?.startedAt ?? null, lastSuccessAt: success?.startedAt ?? null, lastRateLimitedAt: limited?.startedAt ?? null };
}

/**
 * Cron entry point. A no-op unless META_ADS_SYNC_ENABLED=1 and the Meta Ads integration is live with credentials.
 * Read-only towards Meta, time-boxed, and never throws.
 */
export async function syncMetaAds(overrides: { fetch?: typeof fetch; now?: () => Date } = {}): Promise<MetaSyncOutcome> {
  if (!metaAdsSyncEnabled()) return { status: "DISABLED" };
  try {
    const config = await getMetaAdsConfig();
    if (!config.live || !config.accountId || !config.accessToken) return { status: "NOT_CONFIGURED" };
    const accountId = config.accountId;
    const client = createMetaAdsClient({ accountId, accessToken: config.accessToken, apiVersion: config.apiVersion, fetch: overrides.fetch ?? fetch });
    return await runMetaAdsSync({
      now: overrides.now ?? (() => new Date()),
      accountId,
      client,
      history: () => history(accountId),
      upsertRows,
      recordRun: async (run) => {
        await basePrisma.adSyncRun.create({
          data: { ...run, windowStart: run.windowStart ? new Date(`${run.windowStart}T00:00:00.000Z`) : null, windowEnd: run.windowEnd ? new Date(`${run.windowEnd}T00:00:00.000Z`) : null },
        });
      },
      options: syncOptionsFromEnv(),
    });
  } catch (error) {
    // Config could not be read or decrypted. Log only the error class, never its text.
    console.error("Meta ads sync: could not start", error instanceof Error ? error.name : "error");
    return { status: "NOT_CONFIGURED" };
  }
}

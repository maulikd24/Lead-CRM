import { basePrisma } from "@/lib/db/prisma";

import { getMetaAdsConfig, metaAdsSyncEnabled } from "./config";
import { MetaAdsError, createMetaAdsClient } from "./meta-ads";
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

/** A setup problem leaves a FAILED run for the page to show, at most once per interval so a 5-minute tick does not fill the ledger. */
async function recordSetupFailure(accountId: string | null, message: string, now: Date): Promise<MetaSyncOutcome> {
  try {
    const since = new Date(now.getTime() - syncOptionsFromEnv().minIntervalHours * 3_600_000);
    const recent = await basePrisma.adSyncRun.findFirst({ where: { provider: AD_PROVIDER, accountId, status: "FAILED", error: message, startedAt: { gt: since } }, select: { id: true } });
    if (!recent) await basePrisma.adSyncRun.create({ data: { provider: AD_PROVIDER, accountId, status: "FAILED", error: message, startedAt: now, finishedAt: now } });
  } catch {
    console.error("Meta ads sync: could not record a setup failure");
  }
  return { status: "FAILED", rowsUpserted: 0, windowsOk: 0, windowsFailed: 0, error: message };
}

/**
 * Cron entry point. A no-op unless META_ADS_SYNC_ENABLED=1 and the Meta Ads integration is live with credentials.
 * Read-only towards Meta, time-boxed to its own 60 s budget (enforced per request and per page), and never throws.
 */
export async function syncMetaAds(overrides: { fetch?: typeof fetch; now?: () => Date } = {}): Promise<MetaSyncOutcome> {
  if (!metaAdsSyncEnabled()) return { status: "DISABLED" };
  const now = overrides.now ?? (() => new Date());
  let config;
  try {
    config = await getMetaAdsConfig();
  } catch (error) {
    // Log only the error class, never its text.
    console.error("Meta ads sync: could not read the configuration", error instanceof Error ? error.name : "error");
    return recordSetupFailure(null, "Stored credentials could not be read.", now());
  }
  if (!config.live || !config.accountId || !config.accessToken) return { status: "NOT_CONFIGURED" };
  const accountId = config.accountId;
  let client;
  try {
    client = createMetaAdsClient({ accountId, accessToken: config.accessToken, apiVersion: config.apiVersion, fetch: overrides.fetch ?? fetch, now: () => now().getTime() });
  } catch (error) {
    return recordSetupFailure(null, error instanceof MetaAdsError && /account id/i.test(error.message) ? "The ad account id is invalid." : "The Meta Ads settings are incomplete.", now());
  }
  try {
    return await runMetaAdsSync({
      now,
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
    console.error("Meta ads sync: unexpected failure", error instanceof Error ? error.name : "error");
    return { status: "FAILED", rowsUpserted: 0, windowsOk: 0, windowsFailed: 0, error: "Unexpected error during the sync." };
  }
}

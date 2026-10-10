import { getMetaAdsConfig, metaAdsSyncEnabled } from "./config";
import { MetaAdsError, createMetaAdsClient } from "./meta-ads";
import { AD_PROVIDER, DEFAULT_SYNC_OPTIONS, runAdsSync, type SyncOptions, type SyncResult } from "./sync-core";
import { adSyncHistory, recordRun, recordSetupFailure, upsertAdRows } from "./sync-db";

export type MetaSyncOutcome = SyncResult | { status: "DISABLED" } | { status: "NOT_CONFIGURED" };

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function syncOptionsFromEnv(): SyncOptions {
  return { ...DEFAULT_SYNC_OPTIONS, minIntervalHours: intFromEnv("META_ADS_SYNC_EVERY_HOURS", DEFAULT_SYNC_OPTIONS.minIntervalHours, 1, 168) };
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
    return recordSetupFailure(AD_PROVIDER, null, "Stored credentials could not be read.", now(), syncOptionsFromEnv().minIntervalHours);
  }
  if (!config.live || !config.accountId || !config.accessToken) return { status: "NOT_CONFIGURED" };
  const accountId = config.accountId;
  let client;
  try {
    client = createMetaAdsClient({ accountId, accessToken: config.accessToken, apiVersion: config.apiVersion, fetch: overrides.fetch ?? fetch, now: () => now().getTime() });
  } catch (error) {
    return recordSetupFailure(AD_PROVIDER, null, error instanceof MetaAdsError && /account id/i.test(error.message) ? "The ad account id is invalid." : "The Meta Ads settings are incomplete.", now(), syncOptionsFromEnv().minIntervalHours);
  }
  try {
    return await runAdsSync({
      provider: AD_PROVIDER,
      now,
      accountId,
      client,
      history: () => adSyncHistory(AD_PROVIDER, accountId),
      upsertRows: upsertAdRows,
      recordRun,
      options: syncOptionsFromEnv(),
    });
  } catch (error) {
    console.error("Meta ads sync: unexpected failure", error instanceof Error ? error.name : "error");
    return { status: "FAILED", rowsUpserted: 0, windowsOk: 0, windowsFailed: 0, error: "Unexpected error during the sync." };
  }
}

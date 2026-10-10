import { AdsApiError } from "./ads-error";
import { getGoogleAdsConfig, googleAdsReportingEnabled } from "./config-google";
import { GoogleAdsError, createGoogleAdsClient } from "./providers/google-ads";
import { DEFAULT_SYNC_OPTIONS, runAdsSync, type SyncOptions, type SyncResult } from "./sync-core";
import { adSyncHistory, recordRun, recordSetupFailure, upsertAdRows, upsertCreativeRows } from "./sync-db";

export const GOOGLE_PROVIDER = "google";

export type GoogleSyncOutcome = SyncResult | { status: "DISABLED" } | { status: "NOT_CONFIGURED" };

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function googleSyncOptionsFromEnv(): SyncOptions {
  return { ...DEFAULT_SYNC_OPTIONS, minIntervalHours: intFromEnv("GOOGLE_ADS_SYNC_EVERY_HOURS", DEFAULT_SYNC_OPTIONS.minIntervalHours, 1, 168) };
}

/**
 * Cron entry point. A no-op unless GOOGLE_ADS_REPORTING_ENABLED=1 and the Google Ads integration is live with every
 * credential. Read-only towards Google, time-boxed to its own 60 s budget, and never throws.
 */
export async function syncGoogleAds(overrides: { fetch?: typeof fetch; now?: () => Date } = {}): Promise<GoogleSyncOutcome> {
  if (!googleAdsReportingEnabled()) return { status: "DISABLED" };
  const now = overrides.now ?? (() => new Date());
  const intervalHours = googleSyncOptionsFromEnv().minIntervalHours;
  let config;
  try {
    config = await getGoogleAdsConfig();
  } catch (error) {
    // Log only the error class, never its text.
    console.error("Google ads sync: could not read the configuration", error instanceof Error ? error.name : "error");
    return recordSetupFailure(GOOGLE_PROVIDER, null, "Stored credentials could not be read.", now(), intervalHours);
  }
  if (!config.live || !config.customerId || !config.developerToken || !config.clientId || !config.clientSecret || !config.refreshToken) return { status: "NOT_CONFIGURED" };
  const accountId = config.customerId.replace(/-/g, "");
  let client;
  try {
    client = createGoogleAdsClient({
      customerId: config.customerId,
      loginCustomerId: config.loginCustomerId,
      developerToken: config.developerToken,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: config.refreshToken,
      apiVersion: config.apiVersion,
      fetch: overrides.fetch ?? fetch,
      now: () => now().getTime(),
    });
  } catch (error) {
    return recordSetupFailure(GOOGLE_PROVIDER, null, error instanceof GoogleAdsError && /customer id/i.test(error.message) ? "The customer id is invalid." : "The Google Ads settings are incomplete.", now(), intervalHours);
  }
  try {
    return await runAdsSync({
      provider: GOOGLE_PROVIDER,
      now,
      accountId,
      client,
      history: () => adSyncHistory(GOOGLE_PROVIDER, accountId),
      upsertRows: upsertAdRows,
      upsertCreativeRows,
      recordRun,
      options: googleSyncOptionsFromEnv(),
    });
  } catch (error) {
    console.error("Google ads sync: unexpected failure", error instanceof AdsApiError ? error.kind : error instanceof Error ? error.name : "error");
    return { status: "FAILED", rowsUpserted: 0, windowsOk: 0, windowsFailed: 0, error: "Unexpected error during the sync." };
  }
}

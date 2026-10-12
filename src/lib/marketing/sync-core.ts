import { AdsApiError } from "./ads-error";
import type { AccountInfo, CreativeInsightRow, InsightRow } from "./providers/types";
import { addDays, buildWindows, dayDiff, todayInTimeZone, ymdToDate, type DateWindow } from "./dates";

/**
 * Pure core of the ad-spend sync: everything it touches (Meta client, clock, database) is injected, so it is tested
 * without a network or a database. It never throws: any failure becomes a recorded run.
 */

export const AD_PROVIDER = "meta";

export type AdRowInput = {
  provider: string;
  accountId: string;
  campaignId: string;
  campaignName: string;
  /** Account-local calendar day. */
  date: Date;
  spendMinor: bigint;
  currency: string;
  impressions: number;
  clicks: number;
  reach: number;
  leads: number;
  accountTimezone: string;
  syncedAt: Date;
};

export type CreativeRowInput = {
  provider: string;
  accountId: string;
  campaignId: string;
  campaignName: string;
  adId: string;
  adName: string;
  format: string;
  date: Date;
  spendMinor: bigint;
  currency: string;
  impressions: number;
  clicks: number;
  leads: number;
  syncedAt: Date;
};

export type SyncRunStatus = "SUCCESS" | "PARTIAL" | "FAILED" | "RATE_LIMITED";

export type SyncRunRecord = {
  provider: string;
  accountId: string;
  windowStart: string | null;
  windowEnd: string | null;
  status: SyncRunStatus;
  error: string | null;
  rowsUpserted: number;
  campaignsSeen: number;
  windowsOk: number;
  windowsFailed: number;
  startedAt: Date;
  finishedAt: Date;
};

export type SyncHistory = {
  /** Last run that was not rate limited (success or failure): the interval gate counts these. */
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastRateLimitedAt: Date | null;
};

export type SyncOptions = {
  minIntervalHours: number;
  /** Re-synced every run to capture late conversions. */
  trailingDays: number;
  /** Used until a first successful run exists, and as the most a single run ever reads. Matches the longest range the page allows. */
  backfillDays: number;
  windowDays: number;
  budgetMs: number;
  rateLimitCooldownMinutes: number;
};

export type SyncDeps = {
  /** Which platform this run is for; rows and the run ledger are tagged with it. Defaults to Meta. */
  provider?: string;
  now: () => Date;
  accountId: string;
  client: {
    getAccount(): Promise<AccountInfo>;
    getInsights(params: DateWindow & { deadlineMs: number; onSkip: (count: number) => void }): Promise<InsightRow[]>;
    /** Optional: platforms that can report per ad. Only read when `upsertCreativeRows` is also given. */
    getCreativeInsights?(params: DateWindow & { deadlineMs: number; onSkip: (count: number) => void }): Promise<CreativeInsightRow[]>;
  };
  upsertCreativeRows?: (rows: CreativeRowInput[]) => Promise<number>;
  history: () => Promise<SyncHistory>;
  upsertRows: (rows: AdRowInput[]) => Promise<number>;
  recordRun: (run: SyncRunRecord) => Promise<void>;
  options: SyncOptions;
};

export type SyncResult =
  | { status: "SKIPPED"; reason: "interval" | "cooldown" }
  | { status: SyncRunStatus; rowsUpserted: number; windowsOk: number; windowsFailed: number; error: string | null };

export const DEFAULT_SYNC_OPTIONS: SyncOptions = {
  minIntervalHours: 6,
  trailingDays: 7,
  backfillDays: 90,
  windowDays: 7,
  budgetMs: 60_000,
  rateLimitCooldownMinutes: 15,
};

/** Only text this code wrote (or an AdsApiError's already-sanitised message) is stored; raw error text could carry secrets. */
function safeMessage(error: unknown): string {
  if (error instanceof AdsApiError) return error.message.slice(0, 300);
  return `Unexpected ${error instanceof Error ? error.name : "error"} during the sync`.slice(0, 300);
}

export async function runAdsSync(deps: SyncDeps): Promise<SyncResult> {
  const { options } = deps;
  const provider = deps.provider ?? AD_PROVIDER;
  let creativeNote: string | null = null;
  const startedAt = deps.now();
  let windowStart: string | null = null;
  let windowEnd: string | null = null;
  let rowsUpserted = 0;
  let windowsOk = 0;
  let windowsFailed = 0;
  const campaigns = new Set<string>();
  let status: SyncRunStatus = "FAILED";
  let error: string | null = null;
  let rowsSkipped = 0;
  const deadlineMs = startedAt.getTime() + options.budgetMs;

  try {
    const history = await deps.history();
    if (history.lastRateLimitedAt && startedAt.getTime() - history.lastRateLimitedAt.getTime() < options.rateLimitCooldownMinutes * 60_000) {
      return { status: "SKIPPED", reason: "cooldown" };
    }
    if (history.lastAttemptAt && startedAt.getTime() - history.lastAttemptAt.getTime() < options.minIntervalHours * 3_600_000) {
      return { status: "SKIPPED", reason: "interval" };
    }

    const account = await deps.client.getAccount();
    const today = todayInTimeZone(startedAt, account.timezoneName);
    // After a gap, cover everything since the last SUCCESS plus the trailing week; never more than the backfill window.
    const gapDays = history.lastSuccessAt ? dayDiff(todayInTimeZone(history.lastSuccessAt, account.timezoneName), today) : 0;
    const days = history.lastSuccessAt ? Math.min(options.backfillDays, Math.max(options.trailingDays, gapDays + options.trailingDays)) : options.backfillDays;
    windowStart = addDays(today, -(days - 1));
    windowEnd = today;
    const windows = buildWindows(windowStart, windowEnd, options.windowDays);

    let stopped: "rate_limit" | "auth" | "budget" | null = null;
    for (const window of windows) {
      if (deps.now().getTime() - startedAt.getTime() >= options.budgetMs) {
        stopped = "budget";
        error = "Stopped at the time budget; the remaining windows run next time.";
        break;
      }
      try {
        const rows = await deps.client.getInsights({ ...window, deadlineMs, onSkip: (n) => void (rowsSkipped += n) });
        const syncedAt = deps.now();
        const inputs: AdRowInput[] = rows.map((r) => ({
          provider,
          accountId: deps.accountId,
          campaignId: r.campaignId,
          campaignName: r.campaignName,
          date: ymdToDate(r.date),
          spendMinor: r.spendMinor,
          currency: r.currency,
          impressions: r.impressions,
          clicks: r.clicks,
          reach: r.reach,
          leads: r.leads,
          accountTimezone: account.timezoneName,
          syncedAt,
        }));
        rowsUpserted += await deps.upsertRows(inputs);
        for (const r of rows) campaigns.add(r.campaignId);
        windowsOk++;
        if (deps.client.getCreativeInsights && deps.upsertCreativeRows && creativeNote === null) {
          // Ad-level rows are a bonus: a failure here is noted, never allowed to fail the campaign data above. Only a rate limit stops the run.
          try {
            const ads = await deps.client.getCreativeInsights({ ...window, deadlineMs, onSkip: () => {} });
            await deps.upsertCreativeRows(
              ads.map((a) => ({ provider, accountId: deps.accountId, campaignId: a.campaignId, campaignName: a.campaignName, adId: a.adId, adName: a.adName, format: a.format, date: ymdToDate(a.date), spendMinor: a.spendMinor, currency: a.currency, impressions: a.impressions, clicks: a.clicks, leads: a.leads, syncedAt })),
            );
          } catch (creativeError) {
            if (creativeError instanceof AdsApiError && creativeError.kind === "rate_limit") {
              stopped = "rate_limit";
              error = safeMessage(creativeError);
              break;
            }
            if (creativeError instanceof AdsApiError && creativeError.kind === "deadline") {
              stopped = "budget";
              error = "Stopped at the time budget; the remaining windows run next time.";
              break;
            }
            creativeNote = `Ad-level data was skipped: ${safeMessage(creativeError)}`;
          }
        }
      } catch (e) {
        if (e instanceof AdsApiError && e.kind === "deadline") {
          stopped = "budget";
          error = "Stopped at the time budget; the remaining windows run next time.";
          break;
        }
        windowsFailed++;
        error = safeMessage(e);
        if (e instanceof AdsApiError && e.kind === "rate_limit") {
          stopped = "rate_limit";
          break;
        }
        if (e instanceof AdsApiError && e.kind === "auth") {
          stopped = "auth";
          break;
        }
      }
    }

    if (stopped === "rate_limit") status = "RATE_LIMITED";
    else if (stopped === "budget") status = "PARTIAL";
    else if (windowsFailed === 0 && stopped === null) status = "SUCCESS";
    else if (windowsOk > 0) status = "PARTIAL";
    else status = "FAILED";
  } catch (e) {
    status = "FAILED";
    error = safeMessage(e);
  }

  if (rowsSkipped > 0 && status !== "FAILED") {
    const note = `Skipped ${rowsSkipped} rows without a campaign id.`;
    error = error ? `${error} ${note}` : note;
  }
  if (creativeNote) error = error ? `${error} ${creativeNote}` : creativeNote;
  const result: SyncResult = { status, rowsUpserted, windowsOk, windowsFailed, error };
  try {
    await deps.recordRun({
      provider,
      accountId: deps.accountId,
      windowStart,
      windowEnd,
      status,
      error,
      rowsUpserted,
      campaignsSeen: campaigns.size,
      windowsOk,
      windowsFailed,
      startedAt,
      finishedAt: deps.now(),
    });
  } catch (e) {
    console.error("Ad sync: could not record the run", e instanceof Error ? e.name : e);
  }
  return result;
}

/** The Meta entry point, kept under its original name. */
export const runMetaAdsSync = runAdsSync;

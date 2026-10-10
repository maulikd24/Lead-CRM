import { addDays, dayDiff, ymdToDate } from "./dates";
import type { CampaignRow, FunnelStep } from "./metrics";

/** Pure helpers behind the Marketing page: range parsing, number formatting, funnel geometry, sync-state banners, sorting. */

export type RangePreset = "7d" | "30d" | "90d" | "custom";
export type DateRange = { from: string; to: string; preset: RangePreset };

const PRESET_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;
/** Matches the sync's backfill window: spend is never kept for longer, so a longer range would mix 90 days of spend with more days of leads. */
export const MAX_RANGE_DAYS = 90;

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = ymdToDate(value);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** `today` is the ad account's current calendar day. A bad or oversized range quietly becomes the default 30 days. */
export function parseRange(params: Record<string, string | string[] | undefined>, today: string): DateRange {
  const fallback: DateRange = { from: addDays(today, -(PRESET_DAYS["30d"] - 1)), to: today, preset: "30d" };
  const preset = single(params.range);
  if (preset === "7d" || preset === "30d" || preset === "90d") return { from: addDays(today, -(PRESET_DAYS[preset] - 1)), to: today, preset };

  const from = single(params.from);
  const to = single(params.to);
  if (!from || !to || !isRealDate(from) || !isRealDate(to)) return fallback;
  if (from > to || to > today || dayDiff(from, to) + 1 > MAX_RANGE_DAYS) return fallback;
  return { from, to, preset: "custom" };
}

const LOCALE = "en-IN";

export function formatMoney(value: number | null | undefined, currency: string | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  const whole = Math.abs(value) >= 1000;
  try {
    return new Intl.NumberFormat(LOCALE, { style: "currency", currency: currency ?? "INR", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(value);
  } catch {
    return value.toFixed(2);
  }
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(Math.round(value));
}

export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "–" : `${(value * 100).toFixed(1)}%`;
}

export function formatRatio(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "–" : `${value.toFixed(1)}×`;
}

export type FunnelBar = FunnelStep & { widthPct: number };

const MIN_BAR_PCT = 2;

/** Logarithmic widths: impressions are thousands of times larger than funded customers, so linear bars would hide the small end. */
export function funnelBars(steps: FunnelStep[]): FunnelBar[] {
  const max = Math.max(0, ...steps.map((s) => s.value));
  return steps.map((s) => ({ ...s, widthPct: max <= 0 ? MIN_BAR_PCT : Math.max(MIN_BAR_PCT, Math.round((Math.log10(s.value + 1) / Math.log10(max + 1)) * 100)) }));
}

export type Banner = { tone: "neutral" | "warning" | "destructive"; text: string };
export type ConnectionView = { state: "not_connected" | "waiting" | "ready"; banners: Banner[]; lastSyncLabel: string | null };

export const STALE_AFTER_HOURS = 36;

function ago(from: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} days ago`;
}

export type ChannelWording = { label: string; syncFlag: string };
const META_WORDING: ChannelWording = { label: "Meta", syncFlag: "META_ADS_SYNC_ENABLED" };

export function connectionView(input: {
  /** Names used in the banners; defaults to Meta. */
  channel?: ChannelWording;
  live: boolean;
  syncEnabled: boolean;
  hasData: boolean;
  lastSuccessAt: Date | null;
  lastRun: { status: string; error: string | null; startedAt: Date } | null;
  now: Date;
}): ConnectionView {
  const { live, syncEnabled, hasData, lastSuccessAt, lastRun, now } = input;
  const { label, syncFlag } = input.channel ?? META_WORDING;
  const lastSyncLabel = lastSuccessAt ? ago(lastSuccessAt, now) : null;
  const banners: Banner[] = [];
  if (lastRun?.status === "FAILED" || lastRun?.status === "PARTIAL") {
    const failed = lastRun.status === "FAILED";
    banners.push({ tone: failed ? "destructive" : "warning", text: `The last sync ${ago(lastRun.startedAt, now)} ${failed ? "failed" : "only partly worked"}${lastRun.error ? `: ${lastRun.error}` : "."}` });
  } else if (lastRun?.status === "RATE_LIMITED") {
    banners.push({ tone: "warning", text: `${label} asked us to slow down (rate limit) ${ago(lastRun.startedAt, now)}. The sync pauses and tries again shortly.` });
  }
  if (!live && !hasData) return { state: "not_connected", banners, lastSyncLabel };
  if (hasData && (!lastSuccessAt || now.getTime() - lastSuccessAt.getTime() > STALE_AFTER_HOURS * 3_600_000)) {
    banners.push({ tone: "warning", text: `The numbers are older than ${STALE_AFTER_HOURS} hours${lastSuccessAt ? ` (last good sync ${ago(lastSuccessAt, now)})` : ""}. Recent spend may be missing.` });
  }
  if (!live) banners.push({ tone: "warning", text: `${label} Ads is not connected or has been switched off, so these are the numbers from the last sync.` });
  else if (!syncEnabled) {
    banners.push({ tone: "warning", text: `The automatic sync is switched off on this server (${syncFlag} is not 1), so no new spend is being pulled in.` });
  }

  if (!hasData) {
    if (banners.length === 0) banners.push({ tone: "neutral", text: "Connected. The first sync runs on a scheduled check shortly; this page fills in after it." });
    return { state: "waiting", banners, lastSyncLabel };
  }
  return { state: "ready", banners, lastSyncLabel };
}

export type SortKey = keyof Pick<CampaignRow, "name" | "spend" | "impressions" | "clicks" | "metaLeads" | "crmLeads" | "cpl" | "kycRate" | "costPerKyc" | "funded" | "costPerFunded" | "aum" | "aumPerRupee" | "roas">;

/** Sorts a copy. Missing values (null) always go last, in either direction. */
export function sortCampaigns<T extends CampaignRow>(rows: T[], key: SortKey, direction: "asc" | "desc"): T[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key] as string | number | null;
    const y = b[key] as string | number | null;
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    if (typeof x === "string" && typeof y === "string") return sign * x.localeCompare(y, undefined, { sensitivity: "base" });
    return sign * ((x as number) - (y as number));
  });
}

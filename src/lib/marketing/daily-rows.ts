import { prisma } from "@/lib/db/prisma";

import { addDays, todayInTimeZone } from "./dates";
import { minorToMajor } from "./money";

/**
 * The platform's own daily numbers per campaign (spend, impressions, clicks, leads as the platform counts them), read for engines that
 * analyse the platform side of an ad account (Autopilot's pacing, heatmap, waste and tracking checks). This is the marketing module's reader:
 * spend tables are read here and nowhere else. What happened AFTER the click (CRM leads, KYC, funded, revenue, cost per funded, return on
 * spend) is never computed from these rows: it comes from the CampaignOutcomeProvider in lib/attribution.
 */
export type CampaignDayRow = {
  accountId: string;
  campaignId: string;
  campaignName: string;
  channel: "meta" | "google";
  /** YYYY-MM-DD in the ad account's own timezone. */
  date: string;
  currency: string;
  /** Major units of `currency`. */
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
};

export type CampaignDays = {
  timezone: string;
  window: { since: string; until: string };
  rows: CampaignDayRow[];
  /** When the newest row was synced; null when nothing has been synced. */
  dataThrough: Date | null;
};

export async function loadCampaignDays(windowDays: number, now: Date = new Date()): Promise<CampaignDays> {
  const tzRow = await prisma.adCampaignDaily.findFirst({ orderBy: { syncedAt: "desc" }, select: { accountTimezone: true } });
  const timezone = tzRow?.accountTimezone ?? "Asia/Kolkata";
  const until = todayInTimeZone(now, timezone);
  const since = addDays(until, -(windowDays - 1));
  const [rows, latest] = await Promise.all([
    prisma.adCampaignDaily.findMany({ where: { date: { gte: new Date(`${since}T00:00:00Z`), lte: new Date(`${until}T00:00:00Z`) } } }),
    prisma.adCampaignDaily.aggregate({ _max: { syncedAt: true } }),
  ]);
  return {
    timezone, window: { since, until }, dataThrough: latest._max.syncedAt ?? null,
    rows: rows.map((r) => ({
      accountId: r.accountId, campaignId: r.campaignId, campaignName: r.campaignName, channel: r.provider === "google" ? "google" : "meta",
      date: r.date.toISOString().slice(0, 10), currency: r.currency, spend: minorToMajor(r.spendMinor, r.currency),
      impressions: r.impressions, clicks: r.clicks, leads: r.leads,
    })),
  };
}

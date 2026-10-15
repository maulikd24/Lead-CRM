/**
 * Production-like, DEGRADED Marketing data for the layout budget: what the Marketing tabs look like on a bad day, not on the seed's clean
 * one. Thirty more campaigns with ragged history, the last good sync four days old, a failed and a rate-limited run after it, and the CRM
 * counting fewer leads than the ad platform reported. The sync banners stack (failed, stale, switched off, rate limited, lead mismatch),
 * and that stack is what overran the phone budget on the Campaigns tab (1.82 against 1.7). Local database only. Nothing here is a real
 * person or a real campaign. Idempotent.
 *
 *   npm run layout-budget:seed
 *
 * Needs the standard seed and the attribution seed first.
 */
import "dotenv/config";
import "../../src/lib/safety/assert-local-db";

import { prisma } from "../../src/lib/db/prisma";

const DAY = 86_400_000;
const MIN = 60_000;
const now = Date.now();
const ago = (ms: number) => new Date(now - ms);
const day = (n: number) => new Date(`${new Date(now - n * DAY).toISOString().slice(0, 10)}T00:00:00Z`);

const THEMES = ["Retirement", "ELSS Tax Saving", "NRI Investing", "PMS Intro", "Mutual Funds SIP", "Wealth Check", "Child Education", "Goal Planner", "Diwali Offer", "Market Outlook"];

async function google() {
  // Google is only listed while GOOGLE_ADS_REPORTING_ENABLED=1 (not in the CI profile, so the run that reproduces the worst case sets it by hand).
  if (await prisma.adCampaignDaily.findFirst({ where: { accountId: "lb-degraded-g" } })) return;
  for (let i = 0; i < 12; i++) {
    for (let d = 4; d <= 75; d++) {
      if ((d + i) % 6 === 0) continue;
      await prisma.adCampaignDaily.create({
        data: { provider: "google", accountId: "lb-degraded-g", campaignId: `LB-DEG-G${i + 1}`, campaignName: `${THEMES[(i + 3) % THEMES.length]} - Search ${i + 1}`, date: day(d), spendMinor: BigInt((250 + ((i * 53 + d * 7) % 700)) * 100), currency: "INR", impressions: 2000 + d * 8, clicks: 50 + (d % 25), reach: 0, leads: 2 + ((i + d) % 4), accountTimezone: "Asia/Kolkata", syncedAt: ago(3 * DAY) },
      });
    }
  }
  await prisma.adSyncRun.create({ data: { provider: "google", accountId: "lb-degraded-g", status: "SUCCESS", startedAt: ago(3 * DAY), finishedAt: ago(3 * DAY - 40_000) } });
  await prisma.adSyncRun.create({ data: { provider: "google", accountId: "lb-degraded-g", status: "PARTIAL", startedAt: ago(20 * MIN), finishedAt: ago(20 * MIN - 9_000), error: "2 of 6 windows failed" } });
}

async function main() {
  await google();
  if (await prisma.adCampaignDaily.findFirst({ where: { accountId: "lb-degraded" } })) {
    console.log("layout-budget degraded marketing seed already present");
    return;
  }
  for (let i = 0; i < 30; i++) {
    const id = `LB-DEG-${String(i + 1).padStart(2, "0")}`;
    const name = `${THEMES[i % THEMES.length]} - ${["Lead Form", "Traffic", "Retargeting"][i % 3]} ${Math.floor(i / THEMES.length) + 1}`;
    for (let d = 5; d <= 75; d++) {
      if ((d + i) % 7 === 0) continue; // ragged history: missing days
      await prisma.adCampaignDaily.create({
        data: { provider: "meta", accountId: "lb-degraded", campaignId: id, campaignName: name, date: day(d), spendMinor: BigInt((300 + ((i * 37 + d * 11) % 900)) * 100), currency: "INR", impressions: 3000 + d * 10, clicks: 60 + (d % 30), reach: 2500, leads: 3 + ((i + d) % 5), accountTimezone: "Asia/Kolkata", syncedAt: ago(4 * DAY) },
      });
    }
  }
  // The last good sync is four days old, then a failure and a rate limit: stale, failed and rate-limited banners together.
  await prisma.adSyncRun.create({ data: { provider: "meta", accountId: "lb-degraded", status: "SUCCESS", startedAt: ago(4 * DAY), finishedAt: ago(4 * DAY - 40_000) } });
  await prisma.adSyncRun.create({ data: { provider: "meta", accountId: "lb-degraded", status: "RATE_LIMITED", startedAt: ago(2 * DAY), finishedAt: ago(2 * DAY - 10_000), error: "rate limit" } });
  await prisma.adSyncRun.create({ data: { provider: "meta", accountId: "lb-degraded", status: "FAILED", startedAt: ago(10 * MIN), finishedAt: ago(10 * MIN - 5_000), error: "Meta rejected the access token (expired)" } });
  console.log("seeded degraded marketing data");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

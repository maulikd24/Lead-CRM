/**
 * Synthetic Autopilot data for the layout-budget and accessibility runs: the optional platform datasets (search terms, keywords, placements, hours, regional
 * spend, overlap, auction, ad fatigue, tracking signals), pointed at the campaigns the other seeds created, so every Autopilot tab shows data and not only
 * "not available". The audit itself (proposals, scores, outcomes) is computed by the app from the seeded campaigns and leads. Local database only. Idempotent.
 *
 *   npm run layout-budget:seed
 */
import "dotenv/config";
import "../../src/lib/safety/assert-local-db";

import { demoSnapshot } from "../../src/lib/autopilot/fixture.testkit";
import { prisma } from "../../src/lib/db/prisma";

async function main() {
  const meta = (await prisma.adCampaignDaily.findMany({ where: { provider: "meta" }, distinct: ["campaignId"], select: { campaignId: true }, take: 2 })).map((r) => r.campaignId);
  const google = (await prisma.adCampaignDaily.findMany({ where: { provider: "google" }, distinct: ["campaignId"], select: { campaignId: true }, take: 1 })).map((r) => r.campaignId);
  if (!meta.length) { console.log("seed-autopilot: no seeded Meta campaigns (run the other layout-budget seeds first)"); return; }
  const idMap: Record<string, string> = { m1: meta[0], m2: meta[1] ?? meta[0], g1: google[0] ?? meta[0] };
  const re = (id: string) => idMap[id] ?? id;
  const s = demoSnapshot({ withOptional: true });
  const rows: { kind: string; platform: string; payload: unknown }[] = [
    { kind: "searchTerms", platform: "google", payload: (s.searchTerms ?? []).map((r) => ({ ...r, campaignId: re(r.campaignId) })) },
    { kind: "keywords", platform: "google", payload: (s.keywords ?? []).map((r) => ({ ...r, campaignId: re(r.campaignId) })) },
    { kind: "placements", platform: "meta", payload: (s.placements ?? []).map((r) => ({ ...r, campaignId: re(r.campaignId) })) },
    { kind: "hours", platform: "meta", payload: (s.hours ?? []).map((r) => ({ ...r, campaignId: re(r.campaignId) })) },
    { kind: "regionSpend", platform: "meta", payload: s.regionSpend ?? [] },
    { kind: "audienceOverlap", platform: "meta", payload: (s.audienceOverlap ?? []).map((r) => ({ ...r, campaignA: re(r.campaignA), campaignB: re(r.campaignB) })) },
    { kind: "auction", platform: "google", payload: (s.auction ?? []).map((r) => ({ ...r, campaignId: re(r.campaignId) })) },
    { kind: "adFatigue", platform: "meta", payload: (s.adFatigue ?? []).map((r) => ({ ...r, campaignId: re(r.campaignId) })) },
    { kind: "tracking", platform: "meta", payload: s.tracking ?? { events: [], offlineImports: [] } },
  ];
  await prisma.autopilotDataset.deleteMany({ where: { kind: { in: rows.map((r) => r.kind) } } });
  for (const r of rows) await prisma.autopilotDataset.create({ data: { kind: r.kind, platform: r.platform, payload: r.payload as never, capturedAt: new Date() } });
  await prisma.autopilotPlan.upsert({ where: { campaignId: "*" }, create: { campaignId: "*", targetCostPerFunded: 4000, contactSlaMinutes: 15 }, update: {} });
  console.log(`seed-autopilot: ${rows.length} datasets on campaigns ${Object.values(idMap).join(", ")}`);
}

main().then(() => prisma.$disconnect()).catch((e) => { console.error(e); process.exit(1); });

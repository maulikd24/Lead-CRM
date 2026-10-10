/**
 * Synthetic attribution data for the layout-budget test: the busy customer gets a full journey (a Meta campaign and creative, a
 * later enquiry through another campaign, KYC steps, funding, a transaction, revenue), and a handful of leads across four campaigns
 * (some never reached) fill Campaign impact and Lead leakage. Local database only. Nothing here is a real person. Idempotent.
 *
 *   npm run layout-budget:seed
 *
 * Needs the standard seed first (`npx tsx prisma/seed.ts`) and the busy customer (`seed.ts` in this folder).
 */
import "dotenv/config";
import "../../src/lib/safety/assert-local-db";

import { prisma } from "../../src/lib/db/prisma";

const DAY = 86_400_000;
const MIN = 60_000;
const now = Date.now();
const ago = (ms: number) => new Date(now - ms);
const day = (n: number) => new Date(`${new Date(now - n * DAY).toISOString().slice(0, 10)}T00:00:00Z`);

const CAMPAIGNS = [
  { id: "LB-CMP-1", name: "Retirement Planning - Lead Form", spend: 1400 },
  { id: "LB-CMP-2", name: "Tax Saving ELSS", spend: 1900 },
  { id: "LB-CMP-3", name: "NRI Investing", spend: 1100 },
  { id: "LB-CMP-4", name: "PMS Intro", spend: 2600 },
];
const NAMES = ["Anjali Rao", "Rahul Nair", "Pooja Shah", "Vivek Menon", "Sunita Iyer", "Amit Joshi", "Neha Gupta", "Karthik Reddy", "Divya Patel", "Rohit Desai", "Ananya Bhat", "Sanjay Kulkarni"];

async function main() {
  const rm = await prisma.user.findUniqueOrThrow({ where: { email: "rm@supportify.local" } });
  const stage = (await prisma.stage.findFirst({ orderBy: { sequence: "asc" } }))!;
  const busy = await prisma.client.findUnique({ where: { clientCode: "LB-001" } });
  if (!busy) throw new Error("Run the busy customer seed first");
  if (await prisma.client.findUnique({ where: { clientCode: "LB-ATTR-01" } })) {
    console.log("layout-budget attribution seed already present");
    return;
  }

  for (const c of CAMPAIGNS) {
    for (let d = 1; d <= 40; d++) {
      await prisma.adCampaignDaily.create({ data: { provider: "meta", accountId: "lb-acct", campaignId: c.id, campaignName: c.name, date: day(d), spendMinor: BigInt(c.spend * 100), currency: "INR", impressions: 4000, clicks: 120, reach: 3000, leads: 3, accountTimezone: "UTC", syncedAt: ago(2 * 60 * MIN) } });
    }
  }
  await prisma.adSyncRun.create({ data: { provider: "meta", accountId: "lb-acct", status: "SUCCESS", startedAt: ago(2 * 60 * MIN), finishedAt: ago(2 * 60 * MIN - 30_000) } });

  // The busy customer's journey.
  const created = ago(12 * DAY);
  await prisma.client.update({ where: { id: busy.id }, data: { createdAt: created, leadSource: "Meta Ads", leadAttribution: { source: "meta_leads", externalId: "lb-busy-1", platform: "fb", campaign: CAMPAIGNS[0].name, campaign_id: CAMPAIGNS[0].id, ad: "Retire at 55 carousel", form: "FRM-LB-1" } } });
  await prisma.leadIntake.create({ data: { source: "meta_leads", externalId: "lb-busy-1", status: "CREATED", clientId: busy.id, receivedAt: created, rawPayload: { normalized: { leadSource: "Meta Ads", attribution: { campaign_id: CAMPAIGNS[0].id } } } } });
  await prisma.leadIntake.create({ data: { source: "meta_leads", externalId: "lb-busy-2", status: "DUPLICATE", clientId: busy.id, receivedAt: ago(4 * DAY), rawPayload: { normalized: { leadSource: "Meta Ads", attribution: { campaign_id: CAMPAIGNS[1].id, campaign: CAMPAIGNS[1].name, ad: "ELSS in 3 steps reel" } } } } });
  await prisma.activity.create({ data: { clientId: busy.id, userId: rm.id, type: "CONTACT", payload: { message: "Called the lead" }, createdAt: new Date(created.getTime() + 9 * MIN) } });
  let t = created.getTime() + 2 * 60 * MIN;
  for (const [type, mins] of [["PAN_VERIFICATION", 6], ["ADDRESS_VERIFICATION", 40], ["BANK_VERIFICATION", 90], ["IPV", 300], ["ESIGN", 1500]] as const) {
    await prisma.kycStep.upsert({ where: { clientId_holderKey_type: { clientId: busy.id, holderKey: "PRIMARY", type } }, update: {}, create: { clientId: busy.id, holderKey: "PRIMARY", type, status: "VERIFIED", createdAt: new Date(t), decidedAt: new Date(t + mins * MIN) } });
    t += mins * MIN;
  }
  await prisma.kycRecord.upsert({ where: { clientId: busy.id }, update: { status: "APPROVED", completionDate: new Date(t + 20 * MIN) }, create: { clientId: busy.id, status: "APPROVED", completionDate: new Date(t + 20 * MIN) } });
  const fundedAt = new Date(t + 2 * DAY);
  await prisma.fundingRecord.upsert({ where: { clientId: busy.id }, update: { status: "FULLY_FUNDED", amount: 750000, fundingDate: fundedAt }, create: { clientId: busy.id, status: "FULLY_FUNDED", amount: 750000, fundingDate: fundedAt } });
  await prisma.clientPayment.create({ data: { clientId: busy.id, paymentType: "FUNDS_IN", amount: 750000, paidAt: fundedAt, status: "SUCCESS", sourceSystem: "seed", externalRef: "lb-pay-1" } });
  await prisma.revenueEvent.create({ data: { clientId: busy.id, sourceSystem: "seed", externalRef: "lb-rev-1", revenueType: "ADVISORY_FEE", grossRevenueAmount: 6000, eventDate: ago(2 * DAY), rawPayload: {} } });

  // Leads across the four campaigns; the last few from the busiest campaigns were never reached.
  for (const [i, name] of NAMES.entries()) {
    const c = CAMPAIGNS[i % CAMPAIGNS.length];
    const at = ago((i + 1) * DAY * 1.5);
    const reached = i % 4 !== 3;
    const client = await prisma.client.create({
      data: { clientCode: `LB-ATTR-${String(i + 1).padStart(2, "0")}`, name, mobile: `98000000${String(10 + i)}`, currentStageId: stage.id, assignedToId: rm.id, createdAt: at, leadSource: "Meta Ads", leadAttribution: { source: "meta_leads", externalId: `lb-attr-${i}`, platform: "fb", campaign: c.name, campaign_id: c.id, ad: i % 2 ? "Carousel A" : "Reel B", form: "FRM-LB" } },
    });
    await prisma.leadIntake.create({ data: { source: "meta_leads", externalId: `lb-attr-${i}`, status: "CREATED", clientId: client.id, receivedAt: at, rawPayload: { normalized: { leadSource: "Meta Ads", attribution: { campaign_id: c.id } } } } });
    if (reached) await prisma.activity.create({ data: { clientId: client.id, userId: rm.id, type: "CALL", payload: { message: "Spoke to the lead" }, createdAt: new Date(at.getTime() + (i % 2 ? 8 : 90) * MIN) } });
    if (i % 3 === 0 && reached) {
      await prisma.kycRecord.create({ data: { clientId: client.id, status: "APPROVED", completionDate: new Date(at.getTime() + DAY) } });
      await prisma.fundingRecord.create({ data: { clientId: client.id, status: "FULLY_FUNDED", amount: 250000, fundingDate: new Date(at.getTime() + 2 * DAY) } });
      await prisma.revenueEvent.create({ data: { clientId: client.id, sourceSystem: "seed", externalRef: `lb-attr-rev-${i}`, revenueType: "BROKERAGE", grossRevenueAmount: 1800 + i * 100, eventDate: ago(DAY), rawPayload: {} } });
    }
  }
  console.log("seeded attribution data");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

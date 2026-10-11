/**
 * Synthetic data for the Wave 2 C screens (product registry, Needs attention, campaign anomalies), used by the layout-budget and screenshot
 * runs and the role e2e. Everything is fake and labelled: example products, a few customer items for the standard RM, a demo alert and approval,
 * and eight days of a synthetic ad campaign with one spend spike. Local database only. Idempotent. Needs the standard seed first.
 *
 *   npx tsx scripts/layout-budget/seed-wave2c.ts      (also part of `npm run layout-budget:seed`)
 */
import "dotenv/config";
import "../../src/lib/safety/assert-local-db";

import { prisma } from "../../src/lib/db/prisma";
import { seedExampleProducts } from "../../src/lib/registry/seed-examples";

const DAY = 86_400_000;

export async function seedWave2c(): Promise<string> {
  const now = Date.now();
  const ago = (ms: number) => new Date(now - ms);
  const created = await seedExampleProducts(prisma);

  const manager = await prisma.user.findUnique({ where: { email: "manager@supportify.local" } });
  const rm = await prisma.user.findUnique({ where: { email: "rm@supportify.local" } });
  if (!rm) return `example products: ${created.length}; no rm@ user, attention data skipped`;
  const stage = await prisma.stage.findFirstOrThrow({ where: { isActive: true }, orderBy: { sequence: "asc" } });
  const clients = await prisma.client.findMany({ where: { assignedToId: rm.id, isDeleted: false, status: "ACTIVE" }, orderBy: { clientCode: "asc" }, take: 8, select: { id: true, name: true } });
  if (clients.length >= 6) {
    const [c1, c2, c3, c4, c5, c6] = clients;
    const insight = (clientId: string, dedupeKey: string, data: Record<string, unknown>) =>
      prisma.conversationInsight.upsert({ where: { dedupeKey }, update: {}, create: { clientId, dedupeKey, text: "Synthetic example item", sourceType: "NOTE", sourceRef: dedupeKey, occurredAt: ago(2 * DAY), ...data } as never });
    await insight(c1.id, "w2c-complaint-1", { kind: "COMPLAINT", severity: "high", status: "OPEN" });
    await insight(c2.id, "w2c-commitment-1", { kind: "COMMITMENT", status: "OPEN", dueAt: ago(3 * DAY), occurredAt: ago(6 * DAY) });
    if (!(await prisma.exception.findFirst({ where: { clientId: c3.id, reason: "Example: identity document missing" } }))) {
      await prisma.exception.create({ data: { clientId: c3.id, stageId: stage.id, reason: "Example: identity document missing", status: "OPEN", createdAt: ago(3 * DAY) } });
    }
    if (!(await prisma.opportunity.findFirst({ where: { clientId: c4.id, product: "PMS" } }))) {
      await prisma.opportunity.create({ data: { clientId: c4.id, product: "PMS", estimatedValue: 5_000_000, stage: "DECISION_PENDING", stageEnteredAt: ago(9 * DAY), ownerId: rm.id } });
    }
    await prisma.client.update({ where: { id: c5.id }, data: { priority: "HIGH", createdAt: ago(2 * DAY) } });
    for (const [i, c] of [c1, c2, c3, c6].entries()) {
      const title = `Example follow-up ${i + 1}`;
      if (!(await prisma.task.findFirst({ where: { clientId: c.id, title } }))) await prisma.task.create({ data: { clientId: c.id, assignedToId: rm.id, title, dueAt: ago((i + 1) * DAY), category: i === 2 ? "FUNDING" : "FOLLOW_UP" } });
    }
  }
  if (!(await prisma.controlPlaneAlert.findFirst({ where: { key: "w2c-demo-alert" } }))) {
    await prisma.controlPlaneAlert.create({ data: { key: "w2c-demo-alert", severity: "CRITICAL", title: "Example: the scheduler has not run for 40 minutes", firstRaisedAt: ago(40 * 60_000) } });
  }
  if (manager && !(await prisma.approvalRequest.findFirst({ where: { idempotencyKey: "w2c-demo-approval" } }))) {
    await prisma.approvalRequest.create({ data: { actionType: "BULK_REASSIGN", entity: "Client", entityId: clients[0]?.id ?? "example", payload: {}, requestedById: manager.id, requestedAt: ago(2 * DAY), idempotencyKey: "w2c-demo-approval" } });
  }
  for (let i = 1; i <= 8; i++) {
    const date = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() - i));
    await prisma.adCampaignDaily.upsert({
      where: { provider_accountId_campaignId_date: { provider: "meta", accountId: "w2c-demo", campaignId: "w2c-demo-campaign", date } },
      update: {},
      create: { provider: "meta", accountId: "w2c-demo", campaignId: "w2c-demo-campaign", campaignName: "Example campaign (synthetic)", date, spendMinor: BigInt(i === 1 ? 900_000 : 100_000), currency: "INR", impressions: 10_000, clicks: 200, reach: 8_000, leads: 6, syncedAt: new Date(now) },
    });
  }
  return `example products created: ${created.length}; attention demo data ready for ${rm.email}`;
}

if (process.argv[1]?.endsWith("seed-wave2c.ts")) {
  seedWave2c()
    .then((m) => console.log(m))
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}

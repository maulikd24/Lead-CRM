/**
 * Synthetic approvals for the layout-budget test and the screenshots: agent drafts for an RM's customers, social posts waiting for a
 * second person, and requests from Finance and a Manager for an Admin. Local database only. Nothing here is a real person or message.
 * Idempotent: it does nothing when its first marker row exists.
 *
 *   npm run layout-budget:seed      (after `npx tsx prisma/seed.ts` and `npx tsx prisma/seed-e2e.ts`)
 */
import "dotenv/config";

const url = process.env.DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error("Refusing a non-local database");

async function main() {
  const { basePrisma: db } = await import("../../src/lib/db/prisma");
  const MARK = "layout-budget approvals";
  if (await db.agentProposal.findFirst({ where: { reason: { contains: MARK } } })) {
    console.log("approvals seed already present");
    return;
  }
  const now = Date.now();
  const hours = (n: number) => new Date(now - n * 3_600_000);
  const rm = await db.user.findUnique({ where: { email: "rm@supportify.local" } });
  const manager = await db.user.findUnique({ where: { email: "manager@supportify.local" } });
  const finance = await db.user.findUnique({ where: { email: "finance@supportify.local" } });
  const marketing = await db.user.findUnique({ where: { email: "marketing@supportify.local" } });
  if (!rm || !manager || !finance || !marketing) throw new Error("Run prisma/seed-e2e.ts first (it creates the role users)");

  const clients = await db.client.findMany({ where: { assignedToId: rm.id, isDeleted: false }, take: 6, orderBy: { clientCode: "asc" } });
  const drafts = [
    ["Hi {n}, your KYC is one step away. Shall I walk you through the last document?", "KYC pending for 12 days after the last document request"],
    ["Hi {n}, markets were calm this week. Happy to review your goals whenever suits you.", "No contact for 45 days; a goal review is due"],
    ["Hi {n}, your first funding is ready to complete. Would a short call help?", "Funding step open for 9 days"],
    ["Hi {n}, thank you for your time yesterday. I have sent the summary of what we discussed.", "Call yesterday; follow-up pending"],
  ];
  for (const [i, c] of clients.slice(0, drafts.length).entries()) {
    const [body, why] = drafts[i];
    const text = body.replace("{n}", c.name.split(" ")[0]);
    await db.agentProposal.create({ data: { agentKey: "wa_nudger", clientId: c.id, body: text, originalBody: text, reason: `${why} (${MARK})`, programme: i % 2 ? "engagement" : "onboarding", provider: "fake", model: "fake", createdAt: hours(30 - i * 6), expiresAt: new Date(now + (2 + i) * 86_400_000) } });
  }

  const { STANDARD_RISK_LINE } = await import("../../src/lib/marketing/social/compliance");
  const post = (title: string, body: string, source: "STAFF" | "AI", age: number) =>
    db.socialPost.create({ data: { channel: "linkedin", title, body: `${body}\n\n${STANDARD_RISK_LINE}\nSEBI Registration No: INZ000123456`, status: "NEEDS_REVIEW", source, createdById: marketing.id, createdAt: hours(age + 1), updatedAt: hours(age) } });
  await post("Demat accounts explained", "A demat account holds your shares in electronic form. Here is what to check before you open one.", "STAFF", 20);
  await post("Why a goal comes before a fund", "Start with what the money is for, then choose how to invest. A short guide.", "STAFF", 8);
  await post("Understanding mutual fund risk labels", "Every scheme carries a risk label. This is what each colour means.", "AI", 3);

  const ask = (actionType: string, entity: string, entityId: string, payload: object, reason: string, by: string, ageH: number) =>
    db.approvalRequest.create({ data: { actionType, entity, entityId, payload, reason, requestedById: by, requestedAt: hours(ageH), correlationId: `approval:seed:${actionType}:${entityId}` } });
  await ask("PARTNER_TAX_RULE_CHANGE", "PartnerTaxRule", "seed-tax-1", { op: "create", rule: {} }, "Add TDS rule: 10% for resident partners from 1 May", finance.id, 26);
  await ask("PARTNER_OVERRIDE_RULE_CHANGE", "PartnerOverrideRule", "seed-ov-1", { op: "create", rule: {} }, "Add override rule: 5% on a distributor's network", finance.id, 5);
  if (clients[4]) {
    const stage = await db.stage.findFirstOrThrow({ orderBy: { sequence: "desc" } });
    await ask("STAGE_OVERRIDE", "Client", clients[4].id, { clientId: clients[4].id, toStageId: stage.id, reason: "KYC was approved by phone; the stage was not moved" }, "Stage correction", manager.id, 12);
  }
  const er = await db.erasureRequest.create({ data: { subjectType: "Client", subjectId: clients[5]?.id ?? "seed", requestedById: finance.id, notes: "Customer asked in writing to close and erase" } });
  await ask("ERASURE_REQUEST", "ErasureRequest", er.id, { erasureRequestId: er.id }, "Customer asked in writing to close and erase", finance.id, 40);

  await db.aiPilotUser.upsert({ where: { userId: rm.id }, update: {}, create: { userId: rm.id, addedById: manager.id } });
  console.log("approvals seed written: 4 agent drafts, 3 social posts, 4 requests, 1 pilot user");
}

main().finally(async () => (await import("../../src/lib/db/prisma")).basePrisma.$disconnect());

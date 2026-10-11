/**
 * Real-database test for the campaign outcome provider, the attribution events, the lead-clock consumer, the new-lead approval kind and the
 * stand-in pseudonymiser. Needs a throwaway local Postgres, so it is skipped unless ATTRIBUTION_DB_TEST=1 (and refuses any non-local database):
 *   ATTRIBUTION_DB_TEST=1 AUTH_SECRET=x DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch db> npx vitest run src/lib/attribution/outcomes.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.ATTRIBUTION_DB_TEST === "1" && local;

const NOW = new Date("2027-04-20T06:00:00Z");
const RANGE = { from: "2027-04-01", to: "2027-04-20" };
const P = "attr-o-";

describe.skipIf(!enabled)("campaign outcomes, events and approvals on a real database", () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let ids: { a: string; b: string; rm1: string; rm2: string; mgr: string; admin: string };

  async function cleanup() {
    const clients = (await db.client.findMany({ where: { clientCode: { startsWith: "AT-O" } }, select: { id: true } })).map((c) => c.id);
    await db.customerEvent.deleteMany({ where: { clientId: { in: clients } } });
    await db.eventEmitFailure.deleteMany({ where: { clientId: { in: clients } } });
    await db.leadPush.deleteMany({ where: { clientId: { in: clients } } });
    await db.agentProposal.deleteMany({ where: { clientId: { in: clients } } });
    await db.task.deleteMany({ where: { clientId: { in: clients } } });
    await db.$executeRawUnsafe(`DELETE FROM "Notification" WHERE "type" IN ('lead_push', 'lead_sla_breach') AND "userId" LIKE '${P}%'`);
    await db.revenueEvent.deleteMany({ where: { clientId: { in: clients } } });
    await db.clientPayment.deleteMany({ where: { clientId: { in: clients } } });
    await db.fundingRecord.deleteMany({ where: { clientId: { in: clients } } });
    await db.kycRecord.deleteMany({ where: { clientId: { in: clients } } });
    await db.leadIntake.deleteMany({ where: { clientId: { in: clients } } });
    await db.activity.deleteMany({ where: { clientId: { in: clients } } });
    await db.stageHistory.deleteMany({ where: { clientId: { in: clients } } });
    await db.client.deleteMany({ where: { id: { in: clients } } });
    await db.adCampaignDaily.deleteMany({ where: { accountId: "attr-o-acct" } });
    await db.adSyncRun.deleteMany({ where: { accountId: "attr-o-acct" } });
    await db.agentSetting.deleteMany({ where: { agentKey: "lead_first_message" } });
    await db.attributionSetting.deleteMany({});
    await db.user.deleteMany({ where: { id: { startsWith: P } } });
  }

  beforeAll(async () => {
    ({ basePrisma: db } = await import("@/lib/db/prisma"));
    await cleanup();
    const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "Attribution test stage", sequence: 9102, slaHours: 24 } }));
    const user = (id: string, role: "ADMIN" | "MANAGER" | "RM", managerId?: string) => db.user.create({ data: { id: `${P}${id}`, name: `${id} Person`, email: `${P}${id}@example.test`, passwordHash: "x", role, managerId } });
    const admin = await user("admin", "ADMIN");
    const mgr = await user("mgr", "MANAGER");
    const rm1 = await user("rm1", "RM", mgr.id);
    const rm2 = await user("rm2", "RM", mgr.id);
    for (let day = 1; day <= 20; day++) {
      await db.adCampaignDaily.create({ data: { provider: "meta", accountId: "attr-o-acct", campaignId: "211", campaignName: "Outcome Test Campaign", date: new Date(`2027-04-${String(day).padStart(2, "0")}T00:00:00Z`), spendMinor: BigInt(50000), currency: "INR", impressions: 1000, clicks: 40, reach: 800, leads: 2, accountTimezone: "Asia/Kolkata", syncedAt: NOW } });
    }
    await db.adSyncRun.create({ data: { provider: "meta", accountId: "attr-o-acct", status: "SUCCESS", startedAt: new Date(NOW.getTime() - 2 * 3_600_000), finishedAt: NOW } });
    const mk = (code: string, name: string, mobile: string, rm: string, at: string) => db.client.create({ data: { clientCode: code, name, mobile, currentStageId: stage.id, assignedToId: rm, createdAt: new Date(at), leadSource: "Meta Ads", leadAttribution: { source: "meta_leads", externalId: `${code}-L`, platform: "fb", campaign: "Outcome Test Campaign", campaign_id: "211", ad: "Outcome creative", form: "F1" } } });
    const a = await mk("AT-O-A", "Divya Menon", "9000000201", rm1.id, "2027-04-03T05:00:00Z");
    const b = await mk("AT-O-B", "Kabir Sethi", "9000000202", rm2.id, "2027-04-04T05:00:00Z");
    ids = { a: a.id, b: b.id, rm1: rm1.id, rm2: rm2.id, mgr: mgr.id, admin: admin.id };
    for (const c of [a, b]) await db.leadIntake.create({ data: { source: "meta_leads", externalId: `${c.clientCode}-L`, status: "CREATED", clientId: c.id, receivedAt: c.createdAt, rawPayload: { normalized: { leadSource: "Meta Ads", attribution: { campaign_id: "211" } } } } });
    await db.kycRecord.create({ data: { clientId: a.id, status: "APPROVED", completionDate: new Date("2027-04-05T10:00:00Z") } });
    await db.fundingRecord.create({ data: { clientId: a.id, status: "FULLY_FUNDED", amount: 500000, fundingDate: new Date("2027-04-08T05:00:00Z") } });
    await db.clientPayment.create({ data: { clientId: a.id, paymentType: "FUNDS_IN", amount: 500000, paidAt: new Date("2027-04-08T05:00:00Z"), status: "SUCCESS", sourceSystem: "test", externalRef: "attr-o-pay-1" } });
    await db.revenueEvent.create({ data: { clientId: a.id, sourceSystem: "test", externalRef: "attr-o-rev-1", revenueType: "BROKERAGE", grossRevenueAmount: 4000, eventDate: new Date("2027-04-20T00:00:00Z"), rawPayload: {} } });
    await db.activity.create({ data: { clientId: a.id, userId: rm1.id, type: "CONTACT", payload: { message: "called" }, createdAt: new Date("2027-04-03T05:08:00Z") } });
  });

  afterAll(async () => {
    if (db) {
      await cleanup();
      await db.$disconnect();
    }
  });

  describe("the provider reads the same numbers as the Campaign impact tab", () => {
    it("campaign grain: spend, leads, contacted in SLA, KYC, funded and revenue equal the loader's, with data age", async () => {
      const { getCampaignOutcomeProvider } = await import("./outcome-provider-db");
      const { loadImpact } = await import("./impact-db");
      const provider = getCampaignOutcomeProvider({ now: () => NOW });
      const report = await provider.outcomes({ grain: "campaign", period: RANGE }, { kind: "system", consumer: "director-reports" });
      const tab = await loadImpact(RANGE, { id: ids.admin, role: "ADMIN" }, NOW);
      const row = report.rows.find((r) => r.key === "meta:211")!;
      const want = tab.report.rows.find((r) => r.key === "meta:211")!;
      expect(row).toMatchObject({ spend: want.spend, leads: want.leads, contactedInSla: want.contactedInSla, kyc: want.kyc, funded: want.funded, revenue: want.revenue, costPerLead: want.cpl, costPerFunded: want.costPerFunded, roas: want.roas });
      expect(row).toMatchObject({ spend: 10000, leads: 2, funded: 1, kyc: 1, revenue: 4000, channel: "meta" });
      expect(report.dataAge.spend[0]).toMatchObject({ channel: "meta", status: "fresh", coveredDays: 19 });
      expect(row.confidence.label).toBe("insufficient"); // 2 leads: the label says so rather than letting a rate pass as meaningful
      expect(report.totals).toMatchObject({ leads: tab.report.totals.leads, funded: tab.report.totals.funded, revenue: tab.report.totals.revenue });
    });
    it("is aggregates only: no customer name, RM name or id anywhere in what a consumer receives", async () => {
      const { getCampaignOutcomeProvider } = await import("./outcome-provider-db");
      const report = await getCampaignOutcomeProvider({ now: () => NOW }).outcomes({ grain: "ad", period: RANGE }, { kind: "user", id: "mk", role: "MARKETING" });
      const json = JSON.stringify(report);
      for (const secret of ["Divya Menon", "Kabir Sethi", "rm1 Person", ids.a, ids.b, "9000000201"]) expect(json).not.toContain(secret);
      expect(report.rows.find((r) => r.label === "Outcome creative")).toMatchObject({ grain: "ad", leads: 2, funded: 1 });
    });
    it("refuses an RM and a manager before reading anything", async () => {
      const { getCampaignOutcomeProvider } = await import("./outcome-provider-db");
      const provider = getCampaignOutcomeProvider({ now: () => NOW });
      for (const role of ["RM", "MANAGER", "FINANCE"]) await expect(provider.outcomes({ grain: "campaign", period: RANGE }, { kind: "user", id: ids.rm1, role })).rejects.toThrow(/Not allowed/);
    });
  });

  describe("MARKETING sees stand-ins made by the access module's pseudonymiser", () => {
    it("the id and name equal pseudonymize(id), the real name and RM are not in the output", async () => {
      const { pseudonymize } = await import("@/lib/access/pseudonym");
      const { loadImpact } = await import("./impact-db");
      const data = await loadImpact(RANGE, { id: "mk-1", role: "MARKETING" }, NOW);
      const lines = Object.values(data.customers).flat();
      expect(lines.map((l) => l.clientId).sort()).toEqual([pseudonymize(ids.a), pseudonymize(ids.b)].sort());
      expect(lines.map((l) => l.name).sort()).toEqual([`Lead ${pseudonymize(ids.a).slice(2, 7)}`, `Lead ${pseudonymize(ids.b).slice(2, 7)}`].sort());
      const json = JSON.stringify(data);
      for (const real of ["Divya Menon", "Kabir Sethi", "rm1 Person", "rm2 Person"]) expect(json).not.toContain(real);
    });
  });

  describe("events (CUSTOMER_EVENTS_ENABLED), correlated on the customer's flow", () => {
    it("a push stores campaign.lead.pushed once; the sweep stores campaign.lead.sla.breached for a late lead and speed-to-contact for a reached one", async () => {
      vi.stubEnv("CUSTOMER_EVENTS_ENABLED", "1");
      const { pushDeps, sweepDeps } = await import("./db");
      const { pushNewLead, sweepLeadPushes } = await import("./lead-push");
      const { flowCorrelationId } = await import("@/lib/events/envelope");
      const base = { clientName: "x", firstName: "x", rmFirstName: null, touch: null, answers: {}, productInterest: null };
      await pushNewLead({ ...base, clientId: ids.a, assignedToId: ids.rm1, intakeKey: "meta_leads:AT-O-1" }, pushDeps());
      await pushNewLead({ ...base, clientId: ids.b, assignedToId: ids.rm2, intakeKey: "meta_leads:AT-O-2" }, pushDeps());
      await pushNewLead({ ...base, clientId: ids.b, assignedToId: ids.rm2, intakeKey: "meta_leads:AT-O-2" }, pushDeps()); // replay
      expect(await db.customerEvent.count({ where: { eventType: "campaign.lead.pushed", clientId: { in: [ids.a, ids.b] } } })).toBe(2);

      await db.leadPush.updateMany({ where: { clientId: { in: [ids.a, ids.b] } }, data: { dueAt: new Date(Date.now() - 60_000) } });
      await db.activity.create({ data: { clientId: ids.a, userId: ids.rm1, type: "CALL", payload: { message: "spoke" }, createdAt: new Date(Date.now() + 5000) } });
      await sweepLeadPushes(sweepDeps());
      await sweepLeadPushes(sweepDeps()); // idempotent
      const breached = await db.customerEvent.findMany({ where: { eventType: "campaign.lead.sla.breached", clientId: ids.b } });
      expect(breached).toHaveLength(1);
      expect(breached[0].correlationId).toBe(flowCorrelationId(ids.b));
      expect(breached[0].causationId).not.toBeNull();
      expect(JSON.stringify(breached[0].metadata)).not.toMatch(/Kabir|Divya|answers/);
      expect(await db.customerEvent.count({ where: { eventType: "lead.speed_to_contact.measured", clientId: ids.a } })).toBe(1);
      vi.unstubAllEnvs();
    });

    it("with CUSTOMER_EVENTS_ENABLED off nothing is written", async () => {
      const { emitCampaignLeadPushed } = await import("@/lib/events/producers-emit");
      const before = await db.customerEvent.count({ where: { clientId: ids.a } });
      await emitCampaignLeadPushed({ clientId: ids.a, pushId: "never", slaMinutes: 15, assigned: true });
      expect(await db.customerEvent.count({ where: { clientId: ids.a } })).toBe(before);
    });

    it("funded and attributed to a campaign: one campaign.funded.attributed with the campaign id, caused by the funding fact", async () => {
      vi.stubEnv("CUSTOMER_EVENTS_ENABLED", "1");
      vi.stubEnv("NEXT_PUBLIC_ATTRIBUTION", "1");
      vi.stubEnv("NEXT_PUBLIC_MARKETING", "1");
      const { emitCampaignFundedFor } = await import("./events");
      const { clearAttributionContextCache } = await import("./db");
      clearAttributionContextCache();
      await emitCampaignFundedFor({ clientId: ids.a, status: "FULLY_FUNDED", fundedAt: new Date("2027-04-08T05:00:00Z") });
      await emitCampaignFundedFor({ clientId: ids.a, status: "FULLY_FUNDED", fundedAt: new Date("2027-04-08T05:00:00Z") });
      const rows = await db.customerEvent.findMany({ where: { eventType: "campaign.funded.attributed", clientId: ids.a } });
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata).toMatchObject({ campaignId: "211", provider: "meta_ad" });
      expect(rows[0].causationId).not.toBeNull();
      vi.unstubAllEnvs();
    });
  });

  describe("the lead-clock consumer", () => {
    it("closes an open push the moment a person has reached the customer, using the sweep's own definition of contact", async () => {
      const { clockDeps } = await import("./db");
      const { closeClockForClient } = await import("./lead-push");
      await db.leadPush.deleteMany({ where: { clientId: ids.b } });
      await db.leadPush.create({ data: { clientId: ids.b, intakeKey: "meta_leads:AT-O-CLOCK", assignedToId: ids.rm2, context: {}, slaMinutes: 15, dueAt: new Date(Date.now() + 3_600_000) } });
      expect(await closeClockForClient(ids.b, clockDeps())).toBe(0); // nobody has reached them
      await db.activity.create({ data: { clientId: ids.b, userId: ids.rm2, type: "CALL", payload: { message: "spoke" }, createdAt: new Date(Date.now() + 1000) } });
      expect(await closeClockForClient(ids.b, clockDeps())).toBe(1);
      expect((await db.leadPush.findFirstOrThrow({ where: { clientId: ids.b } })).status).toBe("CONTACTED");
      expect(await closeClockForClient(ids.b, clockDeps())).toBe(0); // idempotent
    });
  });

  describe("the new lead's first message is its own approval kind over the AgentProposal rows", () => {
    it("is listed under lead-push-draft to Admin and the owning RM, and not under agent-proposal", async () => {
      vi.stubEnv("LEAD_PUSH_DRAFTS_ENABLED", "1");
      await db.agentSetting.create({ data: { agentKey: "lead_first_message", enabled: true } });
      const proposal = await db.agentProposal.create({ data: { agentKey: "lead_first_message", clientId: ids.a, programme: "New lead", body: "Hi, thanks for your interest. Would a short call suit you?", originalBody: "x", reason: "New lead", status: "DRAFT", provider: "rules", model: "template-v1", inputTokens: 0, outputTokens: 0, expiresAt: new Date(Date.now() + 3_600_000) } });
      const { prismaAdapters } = await import("@/lib/policy/approvals/canonical/wiring");
      const adapters = prismaAdapters();
      const now = new Date();
      const lead = await adapters["lead-push-draft"]!.listAwaiting({ id: ids.admin, role: "ADMIN" }, now, 50);
      expect(lead.map((i) => i.id)).toContain(proposal.id);
      expect(lead.find((i) => i.id === proposal.id)).toMatchObject({ kind: "lead-push-draft", ref: `lead-push-draft:${proposal.id}` });
      expect((await adapters["lead-push-draft"]!.listAwaiting({ id: ids.rm1, role: "RM" }, now, 50)).map((i) => i.id)).toContain(proposal.id);
      expect((await adapters["lead-push-draft"]!.listAwaiting({ id: ids.rm2, role: "RM" }, now, 50)).map((i) => i.id)).not.toContain(proposal.id);
      expect((await adapters["agent-proposal"]!.listAwaiting({ id: ids.admin, role: "ADMIN" }, now, 50)).map((i) => i.id)).not.toContain(proposal.id);
      vi.unstubAllEnvs();
    });
  });
});

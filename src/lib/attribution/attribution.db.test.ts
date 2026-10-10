/**
 * Real-database test for the attribution loaders, the lead push and the escalation sweep. Needs a throwaway local Postgres, so
 * it is skipped unless ATTRIBUTION_DB_TEST=1 (and refuses any non-local database). Run it on its own:
 *   ATTRIBUTION_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch db> npx vitest run src/lib/attribution/attribution.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.ATTRIBUTION_DB_TEST === "1" && local;

const NOW = new Date("2027-04-20T06:00:00Z");
const RANGE = { from: "2027-04-01", to: "2027-04-20" };
const P = "attr-t-";

describe.skipIf(!enabled)("attribution on a real database", () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let ids: { a: string; b: string; c: string; rm1: string; rm2: string; mgr: string; admin: string };

  async function cleanup() {
    const clients = (await db.client.findMany({ where: { clientCode: { startsWith: "AT-T" } }, select: { id: true } })).map((c) => c.id);
    await db.leadPush.deleteMany({ where: { clientId: { in: clients } } });
    await db.agentProposal.deleteMany({ where: { clientId: { in: clients } } });
    await db.task.deleteMany({ where: { clientId: { in: clients } } });
    await db.$executeRawUnsafe(`DELETE FROM "Notification" WHERE "type" IN ('lead_push', 'lead_sla_breach') AND ("userId" LIKE '${P}%' OR "payload"->>'clientName' IN ('Meera Iyer', 'Arjun Nair'))`);
    await db.revenueEvent.deleteMany({ where: { clientId: { in: clients } } });
    await db.clientPayment.deleteMany({ where: { clientId: { in: clients } } });
    await db.kycStep.deleteMany({ where: { clientId: { in: clients } } });
    await db.kycRecord.deleteMany({ where: { clientId: { in: clients } } });
    await db.fundingRecord.deleteMany({ where: { clientId: { in: clients } } });
    await db.partnerReferralTouch.deleteMany({ where: { clientId: { in: clients } } });
    await db.leadIntake.deleteMany({ where: { clientId: { in: clients } } });
    await db.activity.deleteMany({ where: { clientId: { in: clients } } });
    await db.message.deleteMany({ where: { clientId: { in: clients } } });
    await db.stageHistory.deleteMany({ where: { clientId: { in: clients } } });
    await db.client.deleteMany({ where: { id: { in: clients } } });
    await db.partnerProfile.deleteMany({ where: { partnerCode: "AT-PTR" } });
    await db.adCampaignDaily.deleteMany({ where: { accountId: "attr-t-acct" } });
    await db.adSyncRun.deleteMany({ where: { accountId: "attr-t-acct" } });
    await db.agentSetting.deleteMany({ where: { agentKey: "lead_first_message" } });
    await db.attributionSetting.deleteMany({});
    await db.user.deleteMany({ where: { id: { startsWith: P } } });
  }

  beforeAll(async () => {
    ({ basePrisma: db } = await import("@/lib/db/prisma"));
    await cleanup();
    const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "Attribution test stage", sequence: 9101, slaHours: 24 } }));
    const user = (id: string, role: "ADMIN" | "MANAGER" | "RM", managerId?: string) => db.user.create({ data: { id: `${P}${id}`, name: `${id} Person`, email: `${P}${id}@example.test`, passwordHash: "x", role, managerId } });
    const admin = await user("admin", "ADMIN");
    const mgr = await user("mgr", "MANAGER");
    const rm1 = await user("rm1", "RM", mgr.id);
    const rm2 = await user("rm2", "RM");

    for (let day = 1; day <= 20; day++) {
      await db.adCampaignDaily.create({ data: { provider: "meta", accountId: "attr-t-acct", campaignId: "111", campaignName: "Retirement Planning - Lead Form", date: new Date(`2027-04-${String(day).padStart(2, "0")}T00:00:00Z`), spendMinor: BigInt(50000), currency: "INR", impressions: 1000, clicks: 40, reach: 800, leads: 2, accountTimezone: "Asia/Kolkata", syncedAt: NOW } });
    }
    await db.adSyncRun.create({ data: { provider: "meta", accountId: "attr-t-acct", status: "SUCCESS", startedAt: new Date(NOW.getTime() - 2 * 3_600_000), finishedAt: NOW } });

    const a = await db.client.create({ data: { clientCode: "AT-T-A", name: "Meera Iyer", mobile: "9000000101", currentStageId: stage.id, assignedToId: rm1.id, createdAt: new Date("2027-04-03T05:00:00Z"), leadSource: "Meta Ads", leadAttribution: { source: "meta_leads", externalId: "AT-L1", platform: "fb", campaign: "Retirement Planning - Lead Form", campaign_id: "111", ad: "Retire at 55 carousel", form: "F9" } } });
    const b = await db.client.create({ data: { clientCode: "AT-T-B", name: "Arjun Nair", mobile: "9000000102", currentStageId: stage.id, assignedToId: rm2.id, createdAt: new Date("2027-04-04T05:00:00Z"), leadSource: "App Signup", leadAttribution: { source: "allvest_app", externalId: "AT-A2" } } });
    const c = await db.client.create({ data: { clientCode: "AT-T-C", name: "Sunita Rao", mobile: "9000000103", currentStageId: stage.id, createdAt: new Date("2027-04-06T05:00:00Z"), leadSource: "WhatsApp" } });
    ids = { a: a.id, b: b.id, c: c.id, rm1: rm1.id, rm2: rm2.id, mgr: mgr.id, admin: admin.id };

    await db.leadIntake.create({ data: { source: "meta_leads", externalId: "AT-L1", status: "CREATED", clientId: a.id, receivedAt: a.createdAt, rawPayload: { normalized: { leadSource: "Meta Ads", attribution: { campaign_id: "111" } } } } });
    await db.leadIntake.create({ data: { source: "google_ads", externalId: "AT-L2", status: "DUPLICATE", clientId: a.id, receivedAt: new Date("2027-04-10T05:00:00Z"), rawPayload: { normalized: { leadSource: "Google Ads", attribution: { gclid: "z", campaign_id: "g9" } } } } });
    await db.kycRecord.create({ data: { clientId: a.id, status: "APPROVED", completionDate: new Date("2027-04-05T10:00:00Z") } });
    await db.kycStep.create({ data: { clientId: a.id, holderKey: "PRIMARY", type: "PAN_VERIFICATION", status: "VERIFIED", createdAt: new Date("2027-04-03T06:00:00Z"), decidedAt: new Date("2027-04-03T06:05:00Z") } });
    await db.fundingRecord.create({ data: { clientId: a.id, status: "FULLY_FUNDED", amount: 750000, fundingDate: new Date("2027-04-08T05:00:00Z") } });
    await db.clientPayment.create({ data: { clientId: a.id, paymentType: "FUNDS_IN", amount: 750000, paidAt: new Date("2027-04-08T05:00:00Z"), status: "SUCCESS", sourceSystem: "test", externalRef: "attr-t-pay-1" } });
    await db.revenueEvent.create({ data: { clientId: a.id, sourceSystem: "test", externalRef: "attr-t-rev-1", revenueType: "BROKERAGE", grossRevenueAmount: 6000, eventDate: new Date("2027-04-20T00:00:00Z"), rawPayload: {} } });
    await db.activity.create({ data: { clientId: a.id, userId: rm1.id, type: "CONTACT", payload: { message: "called" }, createdAt: new Date("2027-04-03T05:08:00Z") } });

    const partnerUser = await db.user.create({ data: { id: `${P}ptr`, name: "Partner Person", email: `${P}ptr@example.test`, passwordHash: "x", role: "PARTNER" } });
    const profile = await db.partnerProfile.create({ data: { userId: partnerUser.id, partnerCode: "AT-PTR", partnerType: "PARTNER" } });
    await db.partnerReferralTouch.create({ data: { clientId: b.id, partnerProfileId: profile.id, code: "AT-PTR", source: "app", touchedAt: b.createdAt, expiresAt: new Date("2027-06-01T00:00:00Z") } });
  });

  afterAll(async () => {
    if (db) {
      await cleanup();
      await db.$disconnect();
    }
  });

  it("the journey of a Meta customer: first touch, speed to contact, KYC, funding and revenue, each dated", async () => {
    const { loadClientJourney } = await import("./db");
    const j = await loadClientJourney(ids.a, NOW);
    expect(j).not.toBeNull();
    const { journey, attribution } = j!;
    expect(attribution).toMatchObject({ status: "attributed", confidence: "high" });
    expect(journey.first).toMatchObject({ kind: "meta_ad", creative: "Retire at 55 carousel", form: "F9", campaign: { key: "meta:111", name: "Retirement Planning - Lead Form" } });
    const step = (k: string) => journey.steps.find((s) => s.key === k)!;
    expect(step("first_contact")).toMatchObject({ state: "done", slaMet: true });
    expect(step("kyc_pan_verification")).toMatchObject({ state: "done" });
    expect(step("kyc_approved").at).toEqual(new Date("2027-04-05T10:00:00Z"));
    expect(step("first_funding")).toMatchObject({ state: "done", at: new Date("2027-04-08T05:00:00Z") });
    expect(step("revenue").detail).toMatch(/6,000/);
  });

  it("a re-enquiry after funding is a touch but not the last touch before funding", async () => {
    const { loadClientJourney } = await import("./db");
    const j = await loadClientJourney(ids.a, NOW);
    expect(j!.attribution.status === "attributed" && j!.attribution.touches).toHaveLength(2);
    expect(j!.journey.last?.kind).toBe("meta_ad");
  });

  it("a partner customer is credited to the verified code; a hand-entered lead is unattributed with a reason", async () => {
    const { loadClientJourney } = await import("./db");
    const b = await loadClientJourney(ids.b, NOW);
    expect(b!.attribution).toMatchObject({ status: "attributed", first: { kind: "partner_code", code: "AT-PTR", confidence: "high" } });
    expect(b!.journey.steps.find((s) => s.key === "first_contact")!.state).toBe("overdue");
    const c = await loadClientJourney(ids.c, NOW);
    expect(c!.attribution).toMatchObject({ status: "unattributed", reason: "manual_source" });
    expect(c!.journey.steps[0].state).toBe("unknown");
  });

  it("campaign impact for an admin: spend, leads, cost, funded, revenue and return per campaign, every customer listed", async () => {
    const { loadImpact } = await import("./impact-db");
    const data = await loadImpact(RANGE, { id: ids.admin, role: "ADMIN" }, NOW);
    const row = data.report.rows.find((r) => r.key === "meta:111")!;
    expect(row).toMatchObject({ leads: 1, spend: 10000, funded: 1, kyc: 1, revenue: 6000, cpl: 10000 });
    expect(row.roas).toBeCloseTo(0.6);
    expect(data.report.rows.find((r) => r.key === "partner_code")).toMatchObject({ leads: 1, spend: null });
    expect(data.report.rows.find((r) => r.key === "unattributed")).toMatchObject({ leads: 1 });
    expect(data.freshness[0].value).toMatchObject({ stale: false, partial: false, expectedDays: 20, coveredDays: 20 });
    expect(Object.values(data.customers).flat().map((c) => c.name).sort()).toEqual(["Arjun Nair", "Meera Iyer", "Sunita Rao"]);
    expect(data.hiddenCustomers).toBe(0);
    expect(data.groupTotals).toEqual({ "meta:111": 1, partner_code: 1, unattributed: 1 });
  });

  it("for a manager the totals are the same but the customer list is only their own team and the unassigned pool", async () => {
    const { loadImpact } = await import("./impact-db");
    const data = await loadImpact(RANGE, { id: ids.mgr, role: "MANAGER" }, NOW);
    expect(data.report.totals.leads).toBe(3);
    expect(Object.values(data.customers).flat().map((c) => c.name).sort()).toEqual(["Meera Iyer", "Sunita Rao"]);
    expect(data.hiddenCustomers).toBe(1); // Arjun Nair belongs to an RM outside this manager's team
    expect(data.groupTotals.partner_code).toBe(1); // still counted in the group, just not listed
    expect(data.customers.partner_code).toBeUndefined();
  });

  it("the comparison period is aggregates only (no customer names are loaded)", async () => {
    const { loadImpact } = await import("./impact-db");
    const data = await loadImpact({ from: "2027-03-01", to: "2027-03-31" }, null, NOW);
    expect(data.customers).toEqual({});
    expect(data.report.totals.leads).toBe(0);
  });

  describe("lead push and escalation", () => {
    it("pushes a new lead to its RM with the campaign context, writes a DRAFT (never a message), and a replay does nothing", async () => {
      vi.stubEnv("LEAD_PUSH_DRAFTS_ENABLED", "1");
      await db.agentSetting.create({ data: { agentKey: "lead_first_message", enabled: true } });
      const { pushDeps } = await import("./db");
      const { pushNewLead } = await import("./lead-push");
      const touch = { kind: "meta_ad" as const, at: NOW.toISOString(), creative: "Retire at 55 carousel", form: "F9", code: null, confidence: "high" as const, rule: "campaign_id", campaign: { key: "meta:111", id: "111", name: "Retirement Planning - Lead Form", inSpendData: true }, why: "x" };
      const input = { clientId: ids.a, clientName: "Meera Iyer", firstName: "Meera", assignedToId: ids.rm1, rmFirstName: "rm1", intakeKey: "meta_leads:AT-PUSH-1", touch, answers: { goal: "retire early" }, productInterest: "Retirement" };
      const out = await pushNewLead(input, pushDeps());
      expect(out).toMatchObject({ status: "pushed", draft: { status: "drafted" } });
      const row = await db.leadPush.findUniqueOrThrow({ where: { intakeKey: "meta_leads:AT-PUSH-1" } });
      expect(row).toMatchObject({ status: "OPEN", slaMinutes: 15, assignedToId: ids.rm1 });
      expect(row.draftProposalId).toBeTruthy();
      expect(JSON.stringify(row.context)).toContain("Retire at 55 carousel");
      const proposal = await db.agentProposal.findUniqueOrThrow({ where: { id: row.draftProposalId! } });
      expect(proposal).toMatchObject({ status: "DRAFT", agentKey: "lead_first_message", provider: "rules" });
      expect(await db.message.count({ where: { clientId: ids.a } })).toBe(0);
      expect(await db.notification.count({ where: { userId: ids.rm1, type: "lead_push" } })).toBe(1);
      expect(await pushNewLead(input, pushDeps())).toEqual({ status: "skipped", reason: "already pushed" });
      expect(await db.notification.count({ where: { userId: ids.rm1, type: "lead_push" } })).toBe(1);
      expect(await db.agentProposal.count({ where: { clientId: ids.a, agentKey: "lead_first_message" } })).toBe(1);
      vi.unstubAllEnvs();
    });

    it("with the draft switch off the push still happens and no draft is written", async () => {
      const { pushDeps } = await import("./db");
      const { pushNewLead } = await import("./lead-push");
      const out = await pushNewLead({ clientId: ids.b, clientName: "Arjun Nair", firstName: "Arjun", assignedToId: ids.rm2, rmFirstName: "rm2", intakeKey: "web:AT-PUSH-2", touch: null, answers: {}, productInterest: null }, pushDeps());
      expect(out).toMatchObject({ status: "pushed", draft: { status: "skipped" } });
      expect(await db.agentProposal.count({ where: { clientId: ids.b } })).toBe(0);
    });

    it("the sweep escalates an uncontacted push past its SLA to the manager once, and marks a contacted one contacted", async () => {
      const { sweepDeps } = await import("./db");
      const { sweepLeadPushes } = await import("./lead-push");
      // rm1's push (client A) is contacted by a person after it was created; rm2's push (client B) never is.
      await db.leadPush.updateMany({ where: { clientId: { in: [ids.a, ids.b] } }, data: { dueAt: new Date(Date.now() - 60_000) } });
      await db.activity.create({ data: { clientId: ids.a, userId: ids.rm1, type: "CALL", payload: { message: "spoke" }, createdAt: new Date(Date.now() + 5000) } });
      const first = await sweepLeadPushes(sweepDeps());
      expect(first).toMatchObject({ contacted: 1, escalated: 1 });
      const a = await db.leadPush.findFirstOrThrow({ where: { clientId: ids.a } });
      expect(a.status).toBe("CONTACTED");
      expect(a.contactedAt).not.toBeNull();
      const b = await db.leadPush.findFirstOrThrow({ where: { clientId: ids.b } });
      expect(b.status).toBe("ESCALATED");
      // rm2 has no manager: the people who assign leads (the manager and the admin) are told, and one of them gets the task.
      const task = await db.task.findFirstOrThrow({ where: { clientId: ids.b, source: `lead-sla:${b.id}` } });
      expect((await db.user.findUniqueOrThrow({ where: { id: task.assignedToId } })).role).toMatch(/ADMIN|MANAGER/);
      expect(await db.notification.count({ where: { type: "lead_sla_breach", userId: { in: [ids.mgr, ids.admin] } } })).toBe(2);
      const second = await sweepLeadPushes(sweepDeps());
      expect(second).toMatchObject({ escalated: 0 });
      expect(await db.task.count({ where: { clientId: ids.b, source: `lead-sla:${b.id}` } })).toBe(1);
    });
  });
});

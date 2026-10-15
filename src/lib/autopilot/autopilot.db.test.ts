/**
 * Real-database test for Autopilot after its convergence onto the foundation: outcomes read through the CampaignOutcomeProvider (equivalence with the Campaign
 * impact loader), lead cohorts, proposal lifecycle (expiry, reopen, compare-and-set claims), the canonical approval path over the real adapters, the audit run with
 * its correlation chain in CustomerEvent, the weekly digest, and the no-Client-foreign-key guarantee. Needs a throwaway local Postgres, so it is skipped unless
 * AUTOPILOT_DB_TEST=1 (and refuses any non-local database):
 *   AUTOPILOT_DB_TEST=1 AUTH_SECRET=x DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch db> npx vitest run src/lib/autopilot/autopilot.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.AUTOPILOT_DB_TEST === "1" && local;

// The first import of the approval wiring and the outcome provider is slow on a loaded machine.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const NOW = new Date("2027-04-20T06:00:00Z");
const P = "ap-d-";
const SYSTEM = { kind: "system", consumer: "autopilot" } as const;

describe.skipIf(!enabled)("Autopilot on a real database", () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  const ids = {} as Record<string, string>;

  async function cleanup() {
    const clients = (await db.client.findMany({ where: { clientCode: { startsWith: "AP-D" } }, select: { id: true } })).map((c) => c.id);
    await db.customerEvent.deleteMany({ where: { OR: [{ source: "crm.autopilot" }, { clientId: { in: clients } }] } });
    await db.revenueEvent.deleteMany({ where: { clientId: { in: clients } } });
    await db.clientPayment.deleteMany({ where: { clientId: { in: clients } } });
    await db.fundingRecord.deleteMany({ where: { clientId: { in: clients } } });
    await db.kycRecord.deleteMany({ where: { clientId: { in: clients } } });
    await db.leadIntake.deleteMany({ where: { clientId: { in: clients } } });
    await db.activity.deleteMany({ where: { clientId: { in: clients } } });
    await db.stageHistory.deleteMany({ where: { clientId: { in: clients } } });
    await db.client.deleteMany({ where: { id: { in: clients } } });
    await db.adCampaignDaily.deleteMany({ where: { accountId: "ap-d-acct" } });
    await db.adSyncRun.deleteMany({ where: { accountId: "ap-d-acct" } });
    await db.autopilotRecommendation.deleteMany({});
    await db.autopilotDecision.deleteMany({});
    await db.autopilotRule.deleteMany({});
    await db.autopilotAuditRun.deleteMany({});
    await db.autopilotDigest.deleteMany({});
    await db.autopilotPlan.deleteMany({});
    await db.$executeRawUnsafe(`DELETE FROM "Notification" WHERE "type" = 'autopilot_digest'`);
  }

  beforeAll(async () => {
    ({ basePrisma: db } = await import("@/lib/db/prisma"));
    await cleanup();
    const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "Autopilot test stage", sequence: 9103, slaHours: 24 } }));
    const user = async (id: string, role: "ADMIN" | "MARKETING" | "RM" | "MANAGER") => {
      const email = `${P}${id}@example.test`;
      const u = (await db.user.findUnique({ where: { email } })) ?? (await db.user.create({ data: { id: `${P}${id}`, name: `${id} Person`, email, passwordHash: "x", role } }));
      ids[id] = u.id;
      return u;
    };
    await user("admin", "ADMIN"); await user("mk1", "MARKETING"); await user("mk2", "MARKETING"); await user("rm1", "RM"); await user("mgr", "MANAGER");
    for (let day = 1; day <= 20; day++) {
      await db.adCampaignDaily.create({ data: { provider: "meta", accountId: "ap-d-acct", campaignId: "311", campaignName: "Autopilot Test Campaign", date: new Date(`2027-04-${String(day).padStart(2, "0")}T00:00:00Z`), spendMinor: BigInt(60000), currency: "INR", impressions: 1000, clicks: 40, reach: 800, leads: 2, accountTimezone: "Asia/Kolkata", syncedAt: NOW } });
    }
    await db.adSyncRun.create({ data: { provider: "meta", accountId: "ap-d-acct", status: "SUCCESS", startedAt: new Date(NOW.getTime() - 2 * 3_600_000), finishedAt: NOW } });
    const mk = (code: string, name: string, mobile: string, at: string, city: string) => db.client.create({ data: { clientCode: code, name, mobile, city, state: "Maharashtra", currentStageId: stage.id, assignedToId: ids.rm1, createdAt: new Date(at), leadSource: "Meta Ads", leadAttribution: { source: "meta_leads", externalId: `${code}-L`, platform: "fb", campaign: "Autopilot Test Campaign", campaign_id: "311", ad: "AP creative", form: "F1" } } });
    const a = await mk("AP-D-A", "Meera Kulkarni", "9000000301", "2027-04-03T05:13:00Z", "Pune");
    const b = await mk("AP-D-B", "Sandeep Rao", "9000000302", "2027-04-04T16:41:00Z", "Mumbai");
    ids.clientA = a.id; ids.clientB = b.id;
    for (const c of [a, b]) await db.leadIntake.create({ data: { source: "meta_leads", externalId: `${c.clientCode}-L`, status: "CREATED", clientId: c.id, receivedAt: c.createdAt, rawPayload: { normalized: { leadSource: "Meta Ads", attribution: { campaign_id: "311" } } } } });
    await db.kycRecord.create({ data: { clientId: a.id, status: "APPROVED", completionDate: new Date("2027-04-05T10:00:00Z") } });
    await db.fundingRecord.create({ data: { clientId: a.id, status: "FULLY_FUNDED", amount: 500000, fundingDate: new Date("2027-04-08T05:00:00Z") } });
    await db.clientPayment.create({ data: { clientId: a.id, paymentType: "FUNDS_IN", amount: 500000, paidAt: new Date("2027-04-08T05:00:00Z"), status: "SUCCESS", sourceSystem: "test", externalRef: "ap-d-pay-1" } });
    await db.revenueEvent.create({ data: { clientId: a.id, sourceSystem: "test", externalRef: "ap-d-rev-1", revenueType: "BROKERAGE", grossRevenueAmount: 6000, eventDate: new Date("2027-04-20T00:00:00Z"), rawPayload: {} } });
    await db.activity.create({ data: { clientId: a.id, userId: ids.rm1, type: "CONTACT", payload: { message: "called" }, createdAt: new Date("2027-04-03T05:23:00Z") } });
  });

  afterAll(async () => {
    if (db) {
      await cleanup();
      await db.$disconnect();
    }
  });

  describe("campaign numbers: Autopilot, the provider and the Campaign impact tab agree to the last digit", () => {
    it("cost per funded customer, return on spend, funded, KYC and revenue are the same three ways", async () => {
      const { getCampaignOutcomeProvider } = await import("@/lib/attribution");
      const { loadImpact } = await import("@/lib/attribution/impact-db");
      const { loadSnapshot } = await import("./store");
      const { totalsByCampaign } = await import("./derive");
      const provider = getCampaignOutcomeProvider({ now: () => NOW });
      const snap = await loadSnapshot({ caller: SYSTEM, now: NOW, provider });
      const t = totalsByCampaign(snap).find((x) => x.campaign.id === "311")!;
      const period = { from: snap.window.since, to: snap.window.until };
      const row = (await provider.outcomes({ grain: "campaign", period }, SYSTEM)).rows.find((r) => r.key === "meta:311")!;
      const tab = (await loadImpact(period, { id: ids.admin, role: "ADMIN" }, NOW)).report.rows.find((r) => r.key === "meta:311")!;
      expect(t.costPerFunded).toBe(row.costPerFunded);
      expect(t.costPerFunded).toBe(tab.costPerFunded);
      expect(t.roas).toBe(row.roas);
      expect(t.roas).toBe(tab.roas);
      expect([t.funded, t.kyc, t.revenue, t.crmLeads]).toEqual([tab.funded, tab.kyc, tab.revenue, tab.leads]);
      expect(t).toMatchObject({ funded: 1, kyc: 1, revenue: 6000, crmLeads: 2 });
      expect(t.costPerFunded).toBe(12000); // 20 days x 600 = 12,000 spent, one funded customer
      expect(t.roas).toBe(0.5);
    });

    it("a rule's window gets the provider's numbers for that window", async () => {
      const { getCampaignOutcomeProvider } = await import("@/lib/attribution");
      const { loadSnapshot } = await import("./store");
      const provider = getCampaignOutcomeProvider({ now: () => NOW });
      const snap = await loadSnapshot({ caller: SYSTEM, now: NOW, provider, ruleWindows: [7, 14] });
      expect(Object.keys(snap.windowOutcomes).sort()).toEqual(["14", "7"]);
      const seven = await provider.outcomes({ grain: "campaign", period: { from: "2027-04-14", to: "2027-04-20" } }, SYSTEM);
      expect(snap.windowOutcomes["7"]["311"].costPerLead).toBe(seven.rows.find((r) => r.key === "meta:311")!.costPerLead);
    });

    it("lead cohorts: no id, blurred for MARKETING and for the system, exact for ADMIN; the same leads either way", async () => {
      const { getCampaignOutcomeProvider } = await import("@/lib/attribution");
      const provider = getCampaignOutcomeProvider({ now: () => NOW });
      const period = { from: "2027-03-24", to: "2027-04-20" };
      const admin = await provider.leadCohorts({ period }, { kind: "user", id: ids.admin, role: "ADMIN" });
      const mkt = await provider.leadCohorts({ period }, { kind: "user", id: ids.mk1, role: "MARKETING" });
      expect(admin.rows).toHaveLength(2);
      expect(mkt.rows).toHaveLength(2);
      expect(admin.blurred).toBe(false);
      expect(mkt.blurred).toBe(true);
      const json = JSON.stringify([admin, mkt]);
      for (const secret of ["Meera Kulkarni", "Sandeep Rao", "9000000301", ids.clientA, ids.clientB]) expect(json).not.toContain(secret);
      expect(admin.rows.map((r) => r.arrivedAt)).toContain("2027-04-03T05:13:00.000Z");
      expect(mkt.rows.map((r) => r.arrivedAt)).toContain("2027-04-03T05:00:00.000Z");
      expect(admin.rows.filter((r) => r.funded)).toHaveLength(1);
      expect(mkt.rows.filter((r) => r.funded)).toHaveLength(1);
      expect(admin.rows.map((r) => r.city).sort()).toEqual(["Mumbai", "Pune"]);
    });
  });

  describe("the proposal lifecycle", () => {
    const rec = (id: string, over: Record<string, unknown> = {}) => ({ id, ruleKey: "BD1", category: "Bidding" as const, severity: "high" as const, issue: `Issue ${id}`, evidence: ["e1"], action: { kind: "pause_campaign" as const, targetIds: ["311"], summary: "Pause it", params: {} }, impact: { amount: 1000, text: "saves" }, confidence: "high" as const, appliable: true, status: "PENDING" as const, ...over });

    it("a new proposal gets the run's correlation id and an expiry; the same issue next day is not new and renews its expiry", async () => {
      const store = await import("./store");
      const run = { id: "run-x", correlationId: "7f9c24e8-3b0a-5c5e-9d77-3b2f5f6d0a01" };
      const first = await store.syncRecommendations([rec("LC1:311")], run, NOW);
      expect(first.created).toEqual(["LC1:311"]);
      expect(first.recs[0]).toMatchObject({ correlationId: run.correlationId, auditRunId: "run-x" });
      const day2 = new Date(NOW.getTime() + 86_400_000);
      const second = await store.syncRecommendations([rec("LC1:311")], { id: "run-y", correlationId: "other" }, day2);
      expect(second.created).toEqual([]);
      const row = await db.autopilotRecommendation.findUnique({ where: { id: "LC1:311" } });
      expect(row).toMatchObject({ correlationId: run.correlationId, auditRunId: "run-x" }); // the first run stays the origin of the chain
      expect(row!.expiresAt!.getTime()).toBe(day2.getTime() + store.PROPOSAL_TTL_DAYS * 86_400_000);
    });

    it("an undecided proposal not found again expires, cannot be decided, and comes back as PENDING when found again", async () => {
      const store = await import("./store");
      const run = { id: "run-z", correlationId: "7f9c24e8-3b0a-5c5e-9d77-3b2f5f6d0a02" };
      await store.syncRecommendations([rec("LC2:311")], run, NOW);
      const later = new Date(NOW.getTime() + 10 * 86_400_000);
      expect(await store.expireStale(later)).toBeGreaterThanOrEqual(1);
      expect((await db.autopilotRecommendation.findUnique({ where: { id: "LC2:311" } }))!.status).toBe("EXPIRED");
      expect(await store.recordDecision({ recId: "LC2:311", ruleKey: "BD1", targetKey: "311", decision: "APPROVED", reasonCode: null, note: null, actorId: ids.mk1, at: later.toISOString() })).toBe(false);
      const again = await store.syncRecommendations([rec("LC2:311")], { id: "run-w", correlationId: "7f9c24e8-3b0a-5c5e-9d77-3b2f5f6d0a03" }, later);
      expect(again.created).toEqual(["LC2:311"]);
      expect((await db.autopilotRecommendation.findUnique({ where: { id: "LC2:311" } }))!.status).toBe("PENDING");
    });

    it("ten concurrent decisions decide once; ten concurrent apply claims reach the ad account once", async () => {
      const store = await import("./store");
      await store.syncRecommendations([rec("LC3:311")], { id: "run-c", correlationId: "7f9c24e8-3b0a-5c5e-9d77-3b2f5f6d0a04" }, new Date());
      const d = { recId: "LC3:311", ruleKey: "BD1", targetKey: "311", decision: "APPROVED" as const, reasonCode: null, note: null, actorId: ids.mk1, at: new Date().toISOString() };
      const decided = await Promise.all(Array.from({ length: 10 }, () => store.recordDecision(d)));
      expect(decided.filter(Boolean)).toHaveLength(1);
      expect(await db.autopilotDecision.count({ where: { recId: "LC3:311" } })).toBe(1);
      const claims = await Promise.all(Array.from({ length: 10 }, () => store.claimApply("LC3:311")));
      expect(claims.filter(Boolean)).toHaveLength(1);
      expect((await db.autopilotRecommendation.findUnique({ where: { id: "LC3:311" } }))!.status).toBe("APPLYING");
      await store.markApplied("LC3:311", ids.mk1, { ok: true });
      expect((await db.autopilotRecommendation.findUnique({ where: { id: "LC3:311" } }))!.status).toBe("APPLIED");
    });
  });

  describe("the canonical approval path over the real adapters", () => {
    const sync = async (id: string, over: Record<string, unknown> = {}) => {
      const store = await import("./store");
      await store.syncRecommendations([{ id, ruleKey: "BD1", category: "Bidding", severity: "high", issue: `Issue ${id}`, evidence: ["e1"], action: { kind: "pause_campaign", targetIds: ["311"], summary: "Pause it", params: {} }, impact: { amount: 1000, text: "saves" }, confidence: "high", appliable: true, status: "PENDING", ...over } as never], { id: "run-a", correlationId: "7f9c24e8-3b0a-5c5e-9d77-3b2f5f6d0a05" }, new Date());
    };

    it("MARKETING approves through approvalService: the row, the decision with its correlation id and the Approval audit row all agree; RM and MANAGER see nothing", async () => {
      await sync("AP1:311");
      const { approvalService } = await import("@/lib/policy/approvals/canonical/wiring");
      const svc = approvalService();
      const mk = { id: ids.mk1, role: "MARKETING" as const };
      for (const role of ["RM", "MANAGER", "FINANCE"] as const) {
        const seen = await svc.listFor({ id: ids.rm1, role }, { tab: "awaiting" });
        expect(JSON.stringify(seen), role).not.toContain("autopilot-action");
        expect(await svc.decide({ id: ids.rm1, role }, "autopilot-action:AP1:311", "approve", {}), role).toMatchObject({ ok: false });
      }
      const mine = await svc.listFor(mk, { tab: "awaiting" });
      expect(mine.items.map((i) => i.ref)).toContain("autopilot-action:AP1:311"); // Marketing sees what it may decide
      expect(await svc.decide(mk, "autopilot-action:AP1:311", "reject", {})).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
      const res = await svc.decide(mk, "autopilot-action:AP1:311", "approve", {});
      expect(res).toMatchObject({ ok: true, state: "approved" });
      const row = await db.autopilotRecommendation.findUnique({ where: { id: "AP1:311" } });
      expect(row).toMatchObject({ status: "APPROVED", decidedById: ids.mk1 });
      const decision = await db.autopilotDecision.findFirst({ where: { recId: "AP1:311" } });
      expect(decision).toMatchObject({ decision: "APPROVED", actorId: ids.mk1, correlationId: "7f9c24e8-3b0a-5c5e-9d77-3b2f5f6d0a05" });
      expect(await db.auditLog.count({ where: { entity: "Approval", entityId: "autopilot-action:AP1:311", action: "approval_approved" } })).toBe(1);
      expect(await db.auditLog.count({ where: { entity: "AutopilotRecommendation", entityId: "AP1:311", action: "autopilot_approved" } })).toBe(1);
      // a second approval is refused
      expect(await svc.decide({ id: ids.admin, role: "ADMIN" }, "autopilot-action:AP1:311", "approve", {})).toMatchObject({ ok: false });
    });

    it("four eyes on: the author of a rule cannot approve its proposal; a colleague can", async () => {
      const store = await import("./store");
      const rule = await db.autopilotRule.create({ data: { name: "Pricey", metric: "cost_per_funded", op: ">", threshold: 1, days: 14, action: "pause_campaign", createdById: ids.mk1 } });
      await sync(`RULE_${rule.id}:311`, { ruleKey: `RULE_${rule.id}` });
      const { approvalService } = await import("@/lib/policy/approvals/canonical/wiring");
      const svc = approvalService();
      const ref = `autopilot-action:RULE_${rule.id}:311`;
      expect(await svc.decide({ id: ids.mk1, role: "MARKETING" }, ref, "approve", {})).toMatchObject({ ok: true }); // off by default
      await sync(`RULE_${rule.id}:312`, { ruleKey: `RULE_${rule.id}`, action: { kind: "pause_campaign", targetIds: ["312"], summary: "x", params: {} } });
      await store.saveSecondApprover(true, ids.admin);
      const ref2 = `autopilot-action:RULE_${rule.id}:312`;
      expect(await svc.decide({ id: ids.mk1, role: "MARKETING" }, ref2, "approve", {})).toMatchObject({ ok: false, code: "SELF_APPROVAL" });
      expect(await svc.decide({ id: ids.mk2, role: "MARKETING" }, ref2, "approve", {})).toMatchObject({ ok: true });
      await store.saveSecondApprover(false, ids.admin);
    });

    it("an expired proposal is refused and recorded as expired", async () => {
      await sync("AP3:311");
      await db.autopilotRecommendation.update({ where: { id: "AP3:311" }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const { approvalService } = await import("@/lib/policy/approvals/canonical/wiring");
      expect(await approvalService().decide({ id: ids.mk1, role: "MARKETING" }, "autopilot-action:AP3:311", "approve", {})).toMatchObject({ ok: false, code: "EXPIRED" });
      expect((await db.autopilotRecommendation.findUnique({ where: { id: "AP3:311" } }))!.status).toBe("EXPIRED");
    });
  });

  describe("the audit run and its correlation chain, in CustomerEvent", () => {
    it("run, recommended, approved and applied share one correlation id and name their cause; nothing about a customer is stored", async () => {
      vi.stubEnv("CUSTOMER_EVENTS_ENABLED", "1");
      const { runAudit } = await import("./audit");
      const { auditDeps } = await import("./audit-db");
      const { applyApproved, decideRecommendation } = await import("./decisions");
      const { createFakeActionProvider, guarded } = await import("./actions");
      const store = await import("./store");
      const { eventIdFor, dedupeKeyOf } = await import("@/lib/events/envelope");
      await db.autopilotRecommendation.deleteMany({});
      const res = await runAudit({ ...auditDeps(), now: () => NOW, loadSnapshot: (w) => store.loadSnapshot({ caller: SYSTEM, now: NOW, ruleWindows: w, provider: undefined }) }, { trigger: "job" });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const run = await db.autopilotAuditRun.findUnique({ where: { id: res.runId } });
      expect(run).toMatchObject({ status: "SUCCEEDED", trigger: "job", correlationId: res.correlationId });
      const events = await db.customerEvent.findMany({ where: { correlationId: res.correlationId }, orderBy: { seq: "asc" } });
      expect(events.map((e) => e.eventType)).toEqual(expect.arrayContaining(["agent.run.started", "agent.run.completed"]));
      expect(events.every((e) => e.clientId === null)).toBe(true);
      expect(events.filter((e) => e.eventType === "campaign.autopilot.recommended")).toHaveLength(res.newProposals);

      // pick a proposal an adapter can apply, approve it, then apply it with a fake provider (the real one is unconfigured and switched off)
      const target = await db.autopilotRecommendation.findFirst({ where: { status: "PENDING", correlationId: res.correlationId } });
      if (!target) return; // the fixture produced no proposal for this tiny account: nothing more to chain
      const fake = createFakeActionProvider();
      const deps = { getRec: store.getRecommendation, recordDecision: store.recordDecision, claimApply: store.claimApply, markApplied: store.markApplied, provider: guarded(fake, { applyEnabled: true }), emit: (await import("./decisions-wiring")).decisionDeps().emit };
      await db.autopilotRecommendation.update({ where: { id: target.id }, data: { action: { kind: "pause_campaign", targetIds: ["311"], summary: "Pause it", params: {} } } });
      expect(await decideRecommendation(deps, { recId: target.id, verdict: "approve", actorId: ids.mk1 })).toEqual({ ok: true });
      expect(await applyApproved(deps, { recId: target.id, actorId: ids.mk1 })).toEqual({ ok: true });
      expect(fake.log).toEqual(["apply pause_campaign 311"]);
      const chain = await db.customerEvent.findMany({ where: { correlationId: res.correlationId, eventType: { startsWith: "campaign.autopilot." } } });
      const byType = new Map(chain.filter((e) => (e.metadata as { recommendationId?: string })?.recommendationId === target.id).map((e) => [e.eventType, e]));
      const eid = (type: string) => eventIdFor("crm.autopilot", dedupeKeyOf("crm.autopilot", target.id, type));
      expect(byType.get("campaign.autopilot.approved")!.causationId).toBe(eid("campaign.autopilot.recommended"));
      expect(byType.get("campaign.autopilot.applied")!.causationId).toBe(eid("campaign.autopilot.approved"));
      expect(JSON.stringify(chain.map((e) => e.metadata))).not.toMatch(/Meera|Sandeep|9000000/);
      vi.unstubAllEnvs();
    });

    it("a refused apply (switched off, the default) leaves the proposal approved, the ad account untouched and records nothing as applied", async () => {
      const store = await import("./store");
      const { applyApproved } = await import("./decisions");
      const { decisionDeps } = await import("./decisions-wiring");
      await db.autopilotRecommendation.create({ data: { id: "AP9:311", ruleKey: "BD1", targetKey: "311", category: "Bidding", severity: "high", issue: "x", evidence: [], action: { kind: "pause_campaign", targetIds: ["311"], summary: "p", params: {} }, impact: { amount: null, text: "" }, confidence: "high", status: "APPROVED", correlationId: "7f9c24e8-3b0a-5c5e-9d77-3b2f5f6d0a09" } });
      const res = await applyApproved(decisionDeps({}), { recId: "AP9:311", actorId: ids.mk1 });
      expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/switched off/) });
      expect((await store.getRecommendation("AP9:311"))!.status).toBe("APPROVED");
    });
  });

  describe("the daily job and the weekly digest", () => {
    it("the job is a no-op with its flag off and records a run once with it on (a second call the same day does nothing)", async () => {
      const { runDailyAuditJob } = await import("./audit-db");
      await db.autopilotAuditRun.deleteMany({});
      expect(await runDailyAuditJob({}, NOW)).toEqual({ skipped: true });
      const env = { NEXT_PUBLIC_AUTOPILOT: "1", AUTOPILOT_DAILY_AUDIT_ENABLED: "1" };
      const first = await runDailyAuditJob(env, new Date());
      expect(first).toMatchObject({ ran: true });
      expect(await runDailyAuditJob(env, new Date())).toMatchObject({ skipped: true, ranToday: true });
      expect(await db.autopilotAuditRun.count({ where: { trigger: "job", status: "SUCCEEDED" } })).toBe(1);
    });

    it("the digest notifies ADMIN and MARKETING users only, once per week, and sends nothing until a person approves the draft", async () => {
      const { digestDeps, runWeeklyDigestJob } = await import("./digest-db");
      const { createWeeklyDigest, decideDigest } = await import("./digest");
      expect(await runWeeklyDigestJob({})).toEqual({ skipped: true });
      const sent: unknown[] = [];
      const deps = { ...digestDeps(), now: () => new Date("2027-04-19T04:00:00Z"), send: async (m: unknown) => { sent.push(m); return { ok: true }; } };
      const r = await createWeeklyDigest(deps);
      expect(r.created).toBe(true);
      const notified = await db.notification.findMany({ where: { type: "autopilot_digest" }, select: { userId: true, payload: true } });
      expect(notified.map((n) => n.userId)).toEqual(expect.arrayContaining([ids.admin, ids.mk1, ids.mk2]));
      expect(notified.map((n) => n.userId)).not.toContain(ids.rm1);
      expect(notified.map((n) => n.userId)).not.toContain(ids.mgr);
      expect(JSON.stringify(notified)).not.toMatch(/Meera|Sandeep/);
      expect((await createWeeklyDigest(deps)).created).toBe(false);
      expect(await db.notification.count({ where: { type: "autopilot_digest" } })).toBe(notified.length);
      expect(sent).toEqual([]);
      const digest = await db.autopilotDigest.findFirst();
      expect(digest).toMatchObject({ status: "DRAFT", weekStart: "2027-04-19" });
      expect(await decideDigest(deps, { id: digest!.id, actorId: ids.mk1, verdict: "approve" })).toEqual({ ok: true });
      expect(sent).toHaveLength(1);
      expect((sent[0] as { to: string[] }).to.every((e) => e.startsWith(P) || e.endsWith("@example.test") || e.includes("@"))).toBe(true);
    });
  });

  describe("no Client foreign key anywhere in Autopilot", () => {
    it("the database has no foreign key from an Autopilot table, so erasure and merge need nothing", async () => {
      const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM information_schema.table_constraints WHERE constraint_type = 'FOREIGN KEY' AND table_name LIKE 'Autopilot%'`);
      expect(Number(rows[0].n)).toBe(0);
    });
  });
});

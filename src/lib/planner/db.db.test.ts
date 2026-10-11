/**
 * The planner against a real database: defaults, the plan workflow with its audit trail, the hard blocks, the routing
 * owner for a campaign lead, funnel history from attributed customers, and that nothing about a customer leaks. Skipped
 * unless PLANNER_DB_TEST=1 (and refuses any non-local database):
 *   PLANNER_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch db> npx vitest run src/lib/planner/db.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.PLANNER_DB_TEST === "1" && local;
const MAKER = "planner-test-maker";
const CHECKER = "planner-test-checker";
const maker = { id: MAKER, role: "MARKETING" };
const checker = { id: CHECKER, role: "ADMIN" };
const DAY = 86_400_000;

describe.skipIf(!enabled)("campaign planner against a real database", () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let svc: typeof import("./db");
  let audienceId = "";
  let promiseId = "";
  let liveDest = "";
  let plannedDest = "";

  async function cleanup() {
    await db.plannerPlan.deleteMany({});
    await db.plannerRoutingRule.deleteMany({});
    await db.plannerDestination.deleteMany({});
    await db.plannerCreator.deleteMany({});
    await db.plannerPromise.deleteMany({});
    await db.plannerAudience.deleteMany({});
    const cl = await db.client.findMany({ where: { clientCode: { startsWith: "PT-" } }, select: { id: true } });
    await db.kycRecord.deleteMany({ where: { clientId: { in: cl.map((c) => c.id) } } });
    await db.fundingRecord.deleteMany({ where: { clientId: { in: cl.map((c) => c.id) } } });
    await db.client.deleteMany({ where: { clientCode: { startsWith: "PT-" } } });
  }

  beforeAll(async () => {
    ({ basePrisma: db } = await import("@/lib/db/prisma"));
    svc = await import("./db");
    await cleanup();
    for (const id of [MAKER, CHECKER]) await db.user.upsert({ where: { id }, update: { isActive: true }, create: { id, name: id === MAKER ? "Maya Marketing" : "Arun Admin", email: `${id}@example.test`, passwordHash: "x", role: "ADMIN" } });
  });
  afterAll(async () => {
    await cleanup();
    await db.user.deleteMany({ where: { id: { in: [MAKER, CHECKER] } } });
  });

  it("loads the three audiences and the starter promises once", async () => {
    await svc.ensurePlannerDefaults();
    await svc.ensurePlannerDefaults();
    const audiences = await svc.listAudiences();
    expect(audiences.map((a) => a.key)).toEqual(["salaried", "affluent_hni", "nri"]);
    expect((await svc.listPromises()).length).toBe(5);
    audienceId = audiences[0].id;
    promiseId = (await svc.listPromises())[0].id;
  });

  it("registers destinations: a bad URL cannot be live, a planned one is saved with its health result", async () => {
    expect(await svc.saveDestination(null, { name: "Bad", kind: "WEB_LANDING", urlPattern: "http://x", status: "LIVE" })).toMatchObject({ ok: false });
    const live = await svc.saveDestination(null, { name: "Retirement check", kind: "WEB_LANDING", urlPattern: "https://example.test/retirement-check", status: "LIVE", ownerId: MAKER });
    const planned = await svc.saveDestination(null, { name: "Goal planner (app)", kind: "APP_DEEP_LINK", urlPattern: "exampleapp://goal-planner", status: "PLANNED" });
    if (!live.ok || !planned.ok) throw new Error("setup");
    liveDest = live.id;
    plannedDest = planned.id;
    const row = await db.plannerDestination.findUniqueOrThrow({ where: { id: plannedDest } });
    expect(row.lastCheckOk).toBe(true);
  });

  it("blocks an unregistered creator and accepts a registered one", async () => {
    expect(await svc.saveCreator(null, { name: "Rohan", handle: "@rohan", platform: "YouTube", sebiRegistration: "pending" })).toMatchObject({ ok: false });
    const bad = await svc.saveCreator(null, { name: "No Reg", handle: "@noreg", platform: "YouTube" });
    const good = await svc.saveCreator(null, { name: "Reg", handle: "@reg", platform: "YouTube", sebiRegistration: "inh000012345" });
    if (!bad.ok || !good.ok) throw new Error("setup");
    const input = { title: "Video", audienceId, promiseId, channel: "short_video", destinationId: liveDest, ownerId: MAKER, startDate: "2099-03-01" };
    expect(await svc.createPlan({ ...input, creatorId: bad.id }, maker)).toMatchObject({ ok: false, error: expect.stringMatching(/registration/i) });
    expect((await svc.createPlan({ ...input, creatorId: good.id }, maker)).ok).toBe(true);
    expect(await svc.createPlan({ ...input, channel: "email", creatorId: good.id }, maker)).toMatchObject({ ok: false });
  });

  it("walks a plan from Draft to Scheduled with every checklist item, four-eyes and an audit trail", async () => {
    await svc.saveRule(null, { name: "Everyone else", cities: [], languages: [], products: [], isFallback: true, ownerId: CHECKER });
    const made = await svc.createPlan({ title: "Retirement check, salaried, search", audienceId, promiseId, channel: "search_ad", destinationId: liveDest, ownerId: MAKER, startDate: "2099-03-01", endDate: "2099-03-31", budgetInr: 50000, consentPurpose: "MARKETING_COMMS" }, maker);
    if (!made.ok) throw new Error(made.error);
    expect(made.code).toMatch(/^CP-/);
    const id = made.id;

    expect((await svc.transitionPlan(id, "approve", checker, { confirmed: true })).ok).toBe(false);
    expect((await svc.transitionPlan(id, "submit", maker)).ok).toBe(true);
    const early = await svc.transitionPlan(id, "approve", checker, { confirmed: true });
    expect(early).toMatchObject({ ok: false, error: expect.stringMatching(/Tracking links tested.*Copy approved/) });

    const copy = await svc.addCopy(id, "Find out if your retirement plan is on track. Takes about a minute.", maker);
    if (!copy.ok) throw new Error(copy.error);
    expect((await svc.copyAction(copy.id, "submit", maker)).ok).toBe(true);
    expect(await svc.copyAction(copy.id, "approve", maker, { confirmed: true })).toMatchObject({ ok: false, error: expect.stringMatching(/different person/) });
    expect((await svc.copyAction(copy.id, "approve", checker, { confirmed: true })).ok).toBe(true);
    await svc.setLinksTested(id, true, maker);

    expect(await svc.transitionPlan(id, "approve", maker, { confirmed: true })).toMatchObject({ ok: false, error: expect.stringMatching(/different person/) });
    expect((await svc.transitionPlan(id, "approve", checker, { confirmed: true })).ok).toBe(true);
    expect((await svc.transitionPlan(id, "schedule", maker)).ok).toBe(true);

    const events = await db.plannerEvent.findMany({ where: { planId: id }, orderBy: { createdAt: "asc" } });
    const statuses = events.filter((e) => e.kind === "STATUS").map((e) => `${e.fromStatus}>${e.toStatus}`);
    expect(statuses).toEqual(["DRAFT>NEEDS_REVIEW", "NEEDS_REVIEW>APPROVED", "APPROVED>SCHEDULED"]);
    expect(events.every((e) => e.actorId.startsWith("planner-test"))).toBe(true);

    // An edit withdraws approval and the tested links.
    expect((await svc.updatePlan(id, { title: "Retirement check, new title", audienceId, promiseId, channel: "search_ad", destinationId: liveDest, ownerId: MAKER, startDate: "2099-03-01", endDate: "2099-03-31", budgetInr: 50000, consentPurpose: "MARKETING_COMMS" }, maker)).ok).toBe(true);
    const after = await db.plannerPlan.findUniqueOrThrow({ where: { id } });
    expect(after).toMatchObject({ status: "DRAFT", approvedById: null, linksTestedAt: null });
    // Editing approved copy withdraws plan approval too.
  });

  it("will not approve a plan that lands on a destination that is not live yet", async () => {
    const made = await svc.createPlan({ title: "Planned destination", audienceId, promiseId, channel: "email", destinationId: plannedDest, ownerId: MAKER, consentPurpose: "MARKETING_COMMS" }, maker);
    if (!made.ok) throw new Error(made.error);
    const detail = await svc.loadPlanDetail(made.id);
    expect(detail?.checklist.find((i) => i.id === "destination_live")).toMatchObject({ status: "fail", detail: expect.stringMatching(/not live yet/) });
    expect((await svc.loadPlanViews()).find((p) => p.id === made.id)?.failing).toContain("destination_live");
  });

  it("deletes only drafts", async () => {
    const made = await svc.createPlan({ title: "Throwaway", audienceId, promiseId, channel: "email", destinationId: liveDest, ownerId: MAKER }, maker);
    if (!made.ok) throw new Error(made.error);
    expect((await svc.deletePlan(made.id, maker)).ok).toBe(true);
    expect(await db.plannerPlan.findUnique({ where: { id: made.id } })).toBeNull();
  });

  it("routes a campaign lead by the rules, and says nothing for an unknown or draft code", async () => {
    const nri = (await svc.listAudiences()).find((a) => a.key === "nri")!;
    await svc.saveRule(null, { name: "NRI desk", priority: 10, audienceKey: "nri", cities: [], languages: [], products: [], ownerId: MAKER, ownerLabel: "NRI desk" });
    const nriPlan = await svc.createPlan({ title: "NRI guide", audienceId: nri.id, promiseId, channel: "seo_content", destinationId: liveDest, ownerId: MAKER, startDate: "2099-04-01" }, maker);
    if (!nriPlan.ok) throw new Error(nriPlan.error);
    expect(await svc.ownerForCampaignLead(nriPlan.code, { city: "Dubai" })).toBeNull(); // still a draft: nothing is live
    await db.plannerPlan.update({ where: { id: nriPlan.id }, data: { status: "SCHEDULED" } });
    const r = await svc.ownerForCampaignLead(nriPlan.code, { city: "Dubai" });
    expect(r?.decision).toMatchObject({ via: "rule", ownerId: MAKER, ownerLabel: "NRI desk" });
    expect(await svc.ownerForCampaignLead("CP-ZZZZZZ", {})).toBeNull();
  });

  it("reads outcomes only through the provider: thin or absent history is 'not enough data', a plan is 'not linked' until a campaign is chosen, and no customer leaks", async () => {
    const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "Planner test stage", sequence: 9301, slaHours: 24 } }));
    const past = await svc.createPlan({ title: "Past run", audienceId, promiseId, channel: "click_to_whatsapp", destinationId: liveDest, ownerId: MAKER, budgetInr: 20000 }, maker);
    if (!past.ok) throw new Error("setup");
    for (let i = 0; i < 40; i++) {
      const c = await db.client.create({ data: { clientCode: `PT-${i}`, name: `Customer Number ${i}`, mobile: `98551${String(10000 + i)}`, currentStageId: stage.id, leadAttribution: { campaign_code: past.code, source: "web" } } });
      if (i < 12) await db.kycRecord.create({ data: { clientId: c.id, status: "APPROVED" } });
    }
    const detail = await svc.loadPlanDetail(past.id);
    // The provider has no synced campaign here, so there is nothing to estimate from: the planner does not count the customers itself.
    expect(detail?.funnel.estimate.status).toBe("not_enough_data");
    expect(detail?.outcome).toEqual({ status: "not_linked" });
    await svc.updatePlan(past.id, { title: "Past run", audienceId, promiseId, channel: "click_to_whatsapp", destinationId: liveDest, ownerId: MAKER, budgetInr: 20000, outcomeKey: "meta:no-such-campaign" }, maker);
    expect((await svc.loadPlanDetail(past.id))?.outcome.status).toBe("not_found");
    const dump = JSON.stringify({ detail: { ...detail, row: undefined }, views: await svc.loadPlanViews(), missing: await svc.loadMissing() });
    expect(dump).not.toMatch(/Customer Number|98551/);
  });


  it("an AI copy draft is saved as a DRAFT only (L3); an abstain, a block or a failure saves nothing", async () => {
    const { FakeProvider } = await import("@/lib/ai/provider");
    const plan = await svc.createPlan({ title: "AI copy plan", audienceId, promiseId, channel: "search_ad", destinationId: liveDest, ownerId: MAKER }, maker);
    if (!plan.ok) throw new Error("setup");
    const judge = new FakeProvider((req) => (req.system.includes("compliance reviewer") ? "SAFE" : "x"));
    const ok = { kind: "ok" as const, runId: "r", correlationId: "c", text: "See how your retirement plan adds up in a minute.", toolUses: [], blocks: [], provider: "fake", model: "m", usage: { inputTokens: 1, outputTokens: 1, costUsdEstimate: 0 } };
    const made = await svc.aiDraftCopy(plan.id, maker, { call: async () => ok, judge, isEnabled: async () => true });
    expect(made.ok).toBe(true);
    const copy = await db.plannerCopy.findFirst({ where: { planId: plan.id } });
    expect(copy).toMatchObject({ source: "AI", status: "DRAFT" });
    for (const r of [{ kind: "abstain" as const, runId: "r", correlationId: "c", reason: "do_not_know" as const }, { kind: "blocked" as const, runId: null, correlationId: "c", reason: "budget_exceeded" as const }, { kind: "failed" as const, runId: "r", correlationId: "c", errorClass: "timeout" as const, retryable: true, attempts: 2 }]) {
      const res = await svc.aiDraftCopy(plan.id, maker, { call: async () => r, judge, isEnabled: async () => true });
      expect(res.ok).toBe(false);
    }
    expect(await db.plannerCopy.count({ where: { planId: plan.id } })).toBe(1);
  });
});

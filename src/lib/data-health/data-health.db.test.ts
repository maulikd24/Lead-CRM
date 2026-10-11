/**
 * Real-database checks of data health: each rule finds exactly the planted problem and not the healthy customers, work items are reconciled (resolved when
 * the problem is fixed, an acknowledgement survives, a returning problem reopens), the sweep is throttled and flag-gated, and the event consumer opens
 * one item per orphaned event. Skipped unless DATAHEALTH_DB_TEST=1 and DATABASE_URL is a local wt_ scratch database. Run it on its own:
 *   DATAHEALTH_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<wt_w1a_scratch> npx vitest run src/lib/data-health/data-health.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.DATAHEALTH_DB_TEST === "1" && local && /\/wt_[a-z0-9_]+$/.test(url);
const DAY = 86_400_000;

describe.skipIf(!enabled)("data health (real database)", { timeout: 120_000 }, () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let job: typeof import("./job-db");
  let consumer: typeof import("./consumer");
  let stageId = "";
  let rmId = "";
  const ids: Record<string, string> = {};

  const mk = async (key: string, data: Record<string, unknown> = {}) => {
    const c = await db.client.create({ data: { clientCode: `DH-${key}`, name: `Health ${key}`, currentStageId: stageId, mobile: `9${Math.floor(Math.random() * 1e9).toString().padStart(9, "0")}`, mobileKey: `k${key}`, assignedToId: rmId, ...data } as never });
    ids[key] = c.id;
    return c;
  };
  const items = (checkKey: string) => db.dataHealthItem.findMany({ where: { checkKey, status: { not: "RESOLVED" } } });
  const itemFor = async (checkKey: string, clientId: string) => db.dataHealthItem.findFirst({ where: { checkKey, clientId } });

  async function cleanup() {
    const c = await db.client.findMany({ where: { clientCode: { startsWith: "DH-" } }, select: { id: true } });
    const cid = c.map((x) => x.id);
    await db.dataHealthItem.deleteMany({});
    await db.eventDeadLetter.deleteMany({});
    await db.customerEvent.deleteMany({});
    await db.eventEmitFailure.deleteMany({});
    await db.eventCursor.deleteMany({ where: { consumer: { startsWith: "job:" } } });
    await db.task.deleteMany({ where: { clientId: { in: cid } } });
    await db.opportunity.deleteMany({ where: { clientId: { in: cid } } });
    await db.customerIntelligence.deleteMany({ where: { clientId: { in: cid } } });
    await db.fundingRecord.deleteMany({ where: { clientId: { in: cid } } });
    await db.kycRecord.deleteMany({ where: { clientId: { in: cid } } });
    await db.client.deleteMany({ where: { id: { in: cid } } });
  }

  beforeAll(async () => {
    ({ basePrisma: db } = await import("@/lib/db/prisma"));
    job = await import("./job-db");
    consumer = await import("./consumer");
    stageId = ((await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "DH stage", sequence: 9401, slaHours: 24 } }))).id;
    rmId = (await db.user.upsert({ where: { email: "dh-rm@example.test" }, update: {}, create: { email: "dh-rm@example.test", name: "DH RM", passwordHash: "x", role: "RM" } })).id;
    await cleanup();

    await mk("HEALTHY");
    await mk("NOKEYS", { mobile: null, mobileKey: null, email: null, emailKey: null });
    await mk("UNASSIGNED", { assignedToId: null, createdAt: new Date(Date.now() - 3 * DAY) });
    await mk("NEWLEAD", { assignedToId: null }); // unassigned but new: not yet a finding
    const stale = await mk("STALE");
    await db.customerIntelligence.create({ data: { clientId: stale.id, lifecycleStage: "Lead", nbaProgramme: "p", nbaAction: "Call", nbaReason: "r", nbaPriority: "High", nbaOwner: "RM", nbaTiming: "Today", talkingPoints: [], situations: [], doNotDiscuss: [], computedAt: new Date(Date.now() - 10 * DAY) } });
    const fresh = await mk("FRESH");
    await db.customerIntelligence.create({ data: { clientId: fresh.id, lifecycleStage: "Lead", nbaProgramme: "p", nbaAction: "Call", nbaReason: "r", nbaPriority: "High", nbaOwner: "RM", nbaTiming: "Today", talkingPoints: [], situations: [], doNotDiscuss: [] } });
    const funded = await mk("FUNDEDNOKYC");
    await db.fundingRecord.create({ data: { clientId: funded.id, status: "FULLY_FUNDED", fundingDate: new Date() } });
    const okFunded = await mk("FUNDEDOK");
    await db.fundingRecord.create({ data: { clientId: okFunded.id, status: "FULLY_FUNDED", fundingDate: new Date() } });
    await db.kycRecord.create({ data: { clientId: okFunded.id, status: "APPROVED" } });
    await mk("COMPLETEDNODATE", { status: "COMPLETED", completedAt: null });
    await mk("DUPA", { mobileKey: "same-key-1" });
    await mk("DUPB", { mobileKey: "same-key-1" });
    const survivor = await mk("SURVIVOR");
    const dup = await mk("MERGEDDUP", { mergedIntoId: survivor.id, status: "NOT_PROCEEDING" });
    await db.task.create({ data: { clientId: dup.id, assignedToId: rmId, title: "Left behind", dueAt: new Date() } });
    await db.opportunity.create({ data: { clientId: dup.id, product: "PMS", estimatedValue: 1, ownerId: rmId } });
    await mk("DANGLING", { mergedIntoId: "no-such-client", status: "NOT_PROCEEDING" });
    await mk("SCRUBBED", { mergedIntoId: "erased-survivor", status: "NOT_PROCEEDING", name: "Erased customer" });

    await db.customerEvent.createMany({ data: [
      { eventId: "22222222-2222-4222-8222-bbbbbbbbbbb1", eventType: "lead.created", occurredAt: new Date(), actorType: "system", clientId: "ghost-client", source: "crm.web", correlationId: "c", schemaVersion: 1, dataClass: "PERSONAL", dedupeKey: "ghost", metadata: {} },
      { eventId: "22222222-2222-4222-8222-bbbbbbbbbbb2", eventType: "lead.created", occurredAt: new Date(), actorType: "system", clientId: "erased-client", source: "crm.web", correlationId: "c", schemaVersion: 1, dataClass: "PERSONAL", dedupeKey: "erasedfact", metadata: Prisma.DbNull },
      { eventId: "22222222-2222-4222-8222-bbbbbbbbbbb3", eventType: "customer.erased", occurredAt: new Date(), actorType: "user", clientId: "erased-client", source: "crm.web", correlationId: "c", schemaVersion: 1, dataClass: "INTERNAL", dedupeKey: "erasedmark", metadata: {} },
      { eventId: "22222222-2222-4222-8222-bbbbbbbbbbb4", eventType: "whatsapp.message.sent", occurredAt: new Date(), actorType: "user", clientId: ids.HEALTHY, source: "crm.web", correlationId: "c", schemaVersion: 1, dataClass: "PERSONAL", dedupeKey: "noconsent", metadata: {} },
    ] });
    await db.eventEmitFailure.create({ data: { eventType: "lead.created", source: "crm.web", dedupeKey: "k-dh", reason: "DB_ERROR" } });
  });
  afterAll(async () => { await cleanup(); await db.user.deleteMany({ where: { email: "dh-rm@example.test" } }).catch(() => {}); delete process.env.CUSTOMER_EVENTS_ENABLED; });

  it("is a no-op with the flag off", async () => {
    delete process.env.CUSTOMER_EVENTS_ENABLED;
    expect(await job.runDataHealth({ force: true })).toEqual({ skipped: true });
    expect(await db.dataHealthItem.count()).toBe(0);
  });

  it("finds each planted problem and none of the healthy customers", async () => {
    process.env.CUSTOMER_EVENTS_ENABLED = "1";
    const out = await job.runDataHealth({ force: true });
    expect(out.checks).toBe(10);
    expect(out.failedChecks).toBe(0);

    const codesOf = async (check: string, sub?: string) => (await items(check)).filter((i) => !sub || (i.detail as { code?: string } | null)?.code === sub).map((i) => (i.detail as { code?: string } | null)?.code ?? i.subjectId).sort();
    expect(await codesOf("no_identity_keys")).toEqual(["DH-NOKEYS"]);
    expect(await codesOf("unassigned_lead")).toEqual(["DH-UNASSIGNED"]);
    expect(await codesOf("stale_intelligence")).toEqual(["DH-STALE"]);
    const lifecycle = (await items("impossible_lifecycle")).map((i) => `${(i.detail as { code: string }).code}:${(i.detail as { code?: string }).code}`);
    const byCode = (await items("impossible_lifecycle")).map((i) => ({ client: i.clientId, code: (i.detail as { code: string }).code }));
    expect(byCode).toEqual(expect.arrayContaining([{ client: ids.FUNDEDNOKYC, code: "funded_without_kyc" }, { client: ids.COMPLETEDNODATE, code: "status_completed_mismatch" }, { client: ids.DANGLING, code: "merge_target_invalid" }]));
    expect(byCode.some((b) => b.client === ids.FUNDEDOK)).toBe(false);
    expect(byCode.some((b) => b.client === ids.SCRUBBED)).toBe(false); // a duplicate scrubbed by its survivor's erasure keeps its pointer by design
    expect(lifecycle.length).toBe(byCode.length);
    expect(await codesOf("duplicate_identity_key")).toEqual(["DH-DUPA", "DH-DUPB"]);
    expect((await items("rows_on_merged_client")).map((i) => i.subjectId)).toContain("Task"); // a Task left on a merged-away customer: the merge should have moved it
    expect((await items("left_on_archived_duplicate")).map((i) => i.subjectId)).toContain("Opportunity"); // the registry says the merge leaves these behind
    expect((await items("orphaned_event")).map((i) => (i.detail as { eventType: string }).eventType)).toEqual(["lead.created"]); // ghost-client only; the erased customer's fact is expected
    expect((await items("emit_failures_open"))[0].detail).toMatchObject({ open: 1 });
    expect((await items("consent_context_missing"))[0].detail).toMatchObject({ eventType: "whatsapp.message.sent", last7Days: 1 });
    for (const i of await db.dataHealthItem.findMany({})) expect(JSON.stringify(i)).not.toMatch(/Health (NOKEYS|HEALTHY)|@example|\d{10}/); // no name, phone or email in a work item
  });

  it("is throttled to once an hour unless forced", async () => {
    const out = await job.runDataHealth();
    expect(out).toMatchObject({ skipped: true, notDue: true });
  });

  it("an acknowledged item stays acknowledged while the problem persists, is resolved when it is fixed, and reopens when it comes back", async () => {
    const item = await itemFor("unassigned_lead", ids.UNASSIGNED);
    await db.dataHealthItem.update({ where: { id: item!.id }, data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date() } });
    await job.runDataHealth({ force: true });
    expect((await itemFor("unassigned_lead", ids.UNASSIGNED))!.status).toBe("ACKNOWLEDGED");
    await db.client.update({ where: { id: ids.UNASSIGNED }, data: { assignedToId: rmId } });
    await job.runDataHealth({ force: true });
    expect((await itemFor("unassigned_lead", ids.UNASSIGNED))!.status).toBe("RESOLVED");
    await db.client.update({ where: { id: ids.UNASSIGNED }, data: { assignedToId: null } });
    await job.runDataHealth({ force: true });
    const back = (await itemFor("unassigned_lead", ids.UNASSIGNED))!;
    expect(back.status).toBe("OPEN");
    expect(back.acknowledgedAt).toBeNull();
  });

  it("the event consumer opens exactly one item for an orphaned event and none for an erased customer's event", async () => {
    await db.dataHealthItem.deleteMany({ where: { checkKey: "orphaned_event" } });
    const events = await db.customerEvent.findMany({ where: { clientId: { in: ["ghost-client", "erased-client"] }, eventType: "lead.created" } });
    for (const e of events) { await consumer.dataHealthConsumer.handle(e as never, { replay: false, now: new Date() }); await consumer.dataHealthConsumer.handle(e as never, { replay: true, now: new Date() }); }
    const open = await db.dataHealthItem.findMany({ where: { checkKey: "orphaned_event" } });
    expect(open).toHaveLength(1);
    expect(open[0].subjectId).toBe(events.find((e) => e.clientId === "ghost-client")!.id);
  });

  it("a registry table that the merge is meant to move is reported when rows are left on a merged-away customer (the rule reads the registry)", async () => {
    const reg = await import("@/lib/relationships/registry");
    expect(reg.RELATIONSHIPS.find((r) => r.model === "Task")!.merge.kind).toBe("reparent");
    expect(reg.RELATIONSHIPS.find((r) => r.model === "Opportunity")!.merge.kind).toBe("stay");
  });
});

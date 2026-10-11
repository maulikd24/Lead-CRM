/**
 * Closed-loop conversions: the canonical event layer and the canonical approval service, against a real database. Fakes only (no network, no credentials).
 * Skipped unless CLOSEDLOOP_DB_TEST=1 and the database is local:
 *   CLOSEDLOOP_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch db> npx vitest run src/lib/closedloop/events-approvals.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ auth: async () => null }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.CLOSEDLOOP_DB_TEST === "1" && local;
const ENV = { CLOSED_LOOP_CONVERSIONS_ENABLED: "1", CLOSED_LOOP_DEMO: "1" } as Record<string, string>;
const NOW = new Date("2027-03-20T10:00:00Z");
const P = "cl4-";

describe.skipIf(!enabled)("closed loop: events and approvals on a real database", () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let intake: typeof import("./intake-db");
  let job: typeof import("./job");
  let dbmod: typeof import("./db");
  let svc: typeof import("@/lib/policy/approvals/service");
  let applied: typeof import("./db");
  const ids: Record<string, string> = {};

  async function cleanup() {
    const cl = await db.client.findMany({ where: { clientCode: { startsWith: "CL4-" } }, select: { id: true } });
    const clientIds = cl.map((c) => c.id);
    await db.customerEvent.deleteMany({ where: { clientId: { in: clientIds } } });
    await db.conversionOutbox.deleteMany({ where: { clientId: { in: clientIds } } });
    await db.consentRecord.deleteMany({ where: { clientId: { in: clientIds } } }).catch(() => undefined);
    await db.kycRecord.deleteMany({ where: { clientId: { in: clientIds } } });
    await db.fundingRecord.deleteMany({ where: { clientId: { in: clientIds } } });
    await db.client.deleteMany({ where: { id: { in: clientIds } } });
    await db.approvalRequest.deleteMany({ where: { requestedById: { startsWith: P } } });
    // AuditLog is append-only, so the two test users (which hold audit rows) stay; they are upserted and live only in the scratch database.
    await db.integrationConfig.deleteMany({ where: { provider: { startsWith: "closedloop_" } } });
  }

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = "11".repeat(32);
    process.env.CLOSED_LOOP_DEMO = "1";
    ({ basePrisma: db } = await import("@/lib/db/prisma"));
    intake = await import("./intake-db");
    job = await import("./job");
    dbmod = await import("./db");
    applied = dbmod;
    svc = await import("@/lib/policy/approvals/service");
    await import("@/lib/policy/approvals/registry-init");
    await cleanup().catch(() => undefined);
    const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "Closed loop stage", sequence: 9321, slaHours: 24 } }));
    for (const u of ["admin1", "admin2"]) await db.user.upsert({ where: { id: `${P}${u}` }, update: {}, create: { id: `${P}${u}`, name: `CL4 ${u}`, email: `${P}${u}@example.test`, passwordHash: "x", role: "ADMIN" } });
    let n = 0;
    const mk = async (code: string) =>
      (ids[code] = (await db.client.create({ data: { clientCode: `CL4-${code}`, name: `Synthetic ${code}`, mobile: `98420${String(++n).padStart(5, "0")}`, email: `cl4-${code.toLowerCase()}@example.test`, currentStageId: stage.id, leadAttribution: { gclid: "G-1", fbclid: "F-1" } } })).id);
    for (const c of ["A", "B"]) {
      await mk(c);
      await db.kycRecord.create({ data: { clientId: ids[c], status: "APPROVED", completionDate: new Date("2027-03-19T08:00:00Z") } });
      await db.fundingRecord.create({ data: { clientId: ids[c], status: "FULLY_FUNDED", amount: 250000, fundingDate: new Date("2027-03-19T09:00:00Z") } });
      await db.consentRecord.create({ data: { clientId: ids[c], purpose: "ADS_MEASUREMENT", status: "GRANTED", source: "RM_RECORDED", reason: "test", capturedAt: new Date("2026-01-01T00:00:00Z") } });
    }
    await db.integrationConfig.create({ data: { provider: "closedloop_fake", credentials: (await import("@/lib/security/crypto")).encryptJson({}), settings: { enabled: true, region: "global", allowedRegions: ["global"], sendValue: false }, isEnabled: true } });
  });
  afterAll(async () => {
    if (db) {
      await cleanup();
      await db.$disconnect();
    }
  });

  const snapshot = async (clientId: string) =>
    (await db.conversionOutbox.findMany({ where: { clientId }, orderBy: { dedupId: "asc" } })).map((r) => ({ d: r.destination, e: r.eventType, dedup: r.dedupId, at: r.occurredAt.toISOString(), identity: r.identity, value: r.value }));

  it("the event path and the sweep write the same rows for the same customer (dual path, equivalence)", async () => {
    // Sweep first, with the window around the test facts.
    const sweepNow = new Date("2027-03-20T10:00:00Z");
    await intake.produceForClient(ids.B, ENV, sweepNow); // the event path, for B
    const viaEvent = await snapshot(ids.B);
    expect(viaEvent).toHaveLength(2);

    await job.runClosedLoopJob({ env: { ...ENV, CLOSED_LOOP_MAX_PER_RUN: "1" }, fetchImpl: async () => ({ status: 200, ok: true, json: async () => ({}) }), now: () => sweepNow }); // the sweep, for everyone
    expect(await snapshot(ids.B)).toEqual(viaEvent); // the sweep added nothing and changed nothing about B's rows
    const a = await snapshot(ids.A);
    expect(a.map((r) => r.e).sort()).toEqual(viaEvent.map((r) => r.e).sort());
    expect(a.map((r) => r.dedup)).not.toEqual(viaEvent.map((r) => r.dedup)); // dedup ids are per customer
    // Producing again, by either path, is a no-op.
    await intake.produceForClient(ids.A, ENV, sweepNow);
    expect(await db.conversionOutbox.count({ where: { clientId: { in: [ids.A, ids.B] } } })).toBe(4);
  });

  it("a customer with no ad measurement consent is not read at all by the event path", async () => {
    const none = await db.client.create({ data: { clientCode: "CL4-NOCONSENT", name: "Synthetic N", mobile: "9842099999", currentStageId: (await db.stage.findFirstOrThrow()).id } });
    await db.kycRecord.create({ data: { clientId: none.id, status: "APPROVED", completionDate: new Date("2027-03-19T08:00:00Z") } });
    await intake.produceForClient(none.id, ENV, NOW);
    expect(await db.conversionOutbox.count({ where: { clientId: none.id } })).toBe(0);
  });

  it("the consumer cancels a customer's unsent rows when ad measurement consent is withdrawn (and only for that purpose)", async () => {
    const consumer = intake.createClosedLoopConsumer();
    const ev = (purpose: string) => ({ id: "e", seq: BigInt(1), eventId: "00000000-0000-4000-8000-000000000001", eventType: "customer.consent.withdrawn", occurredAt: NOW, receivedAt: NOW, actorType: "user", actorId: null, clientId: ids.A, source: "crm.web", correlationId: "00000000-0000-4000-8000-0000000000aa", causationId: null, schemaVersion: 1, consentContext: null, metadata: { purpose }, dataClass: "PERSONAL", dedupeKey: "k", late: false, clockSkew: false });
    await db.conversionOutbox.updateMany({ where: { clientId: ids.A }, data: { status: "PENDING", reason: null } });
    process.env.CLOSED_LOOP_CONVERSIONS_ENABLED = "1";
    await consumer.handle(ev("MARKETING_COMMS") as never, { replay: false, now: NOW });
    expect(await db.conversionOutbox.count({ where: { clientId: ids.A, status: "PENDING" } })).toBe(2);
    await consumer.handle(ev("ADS_MEASUREMENT") as never, { replay: false, now: NOW });
    expect(await db.conversionOutbox.count({ where: { clientId: ids.A, status: "SKIPPED", reason: "CONSENT_WITHDRAWN" } })).toBe(2);
  });

  it("send results become canonical events: sent carries the destination and kind only, never an identifier", async () => {
    process.env.CUSTOMER_EVENTS_ENABLED = "1";
    await db.conversionOutbox.updateMany({ where: { clientId: ids.B }, data: { status: "PENDING", reason: null, sentAt: null, attempts: 0 } });
    const r = await job.runClosedLoopJob({ env: ENV, fetchImpl: async () => ({ status: 200, ok: true, json: async () => ({}) }), now: () => NOW });
    expect(r).toMatchObject({ drained: { sent: expect.any(Number) } });
    const events = await db.customerEvent.findMany({ where: { clientId: ids.B, eventType: "campaign.conversion.sent" } });
    expect(events.length).toBe(2);
    const blob = JSON.stringify(events.map((e) => e.metadata));
    expect(blob).toContain("fake");
    expect(blob).not.toMatch(/hash|email|phone|gclid|fbc|[0-9a-f]{40}|98420|example/i);
    expect(events[0].consentContext).toMatchObject({ purpose: "ADS_MEASUREMENT" });
    // Replaying the same results stores nothing new (keyed on the outbox row).
    await db.conversionOutbox.updateMany({ where: { clientId: ids.B }, data: { status: "PENDING" } });
    await job.runClosedLoopJob({ env: ENV, fetchImpl: async () => ({ status: 200, ok: true, json: async () => ({}) }), now: () => NOW });
    expect(await db.customerEvent.count({ where: { clientId: ids.B, eventType: "campaign.conversion.sent" } })).toBe(2);
    delete process.env.CUSTOMER_EVENTS_ENABLED;
  });

  it("enabling a destination: requested by one Admin, not applied, refused to the same person, applied when another Admin approves", async () => {
    await db.integrationConfig.update({ where: { provider: "closedloop_fake" }, data: { settings: { enabled: false, region: null, allowedRegions: [], sendValue: false }, isEnabled: false } });
    const maker = { id: `${P}admin1`, role: "ADMIN" as const };
    const checker = { id: `${P}admin2`, role: "ADMIN" as const };
    const req = await svc.requestApproval("CLOSED_LOOP_DESTINATION", { entity: "ClosedLoopDestination", entityId: "fake", payload: { destination: "fake", enabled: true, region: "global", allowedRegions: ["global"], sendValue: false } }, maker);
    expect((await db.integrationConfig.findUniqueOrThrow({ where: { provider: "closedloop_fake" } })).isEnabled).toBe(false);
    await expect(svc.decideApproval(req.id, "APPROVED", undefined, maker)).rejects.toThrow(/Maker cannot also be checker/);
    await svc.decideApproval(req.id, "APPROVED", "Region confirmed by legal", checker);
    const row = await db.integrationConfig.findUniqueOrThrow({ where: { provider: "closedloop_fake" } });
    expect(row).toMatchObject({ isEnabled: true, settings: { enabled: true, region: "global", allowedRegions: ["global"], sendValue: false } });
    expect(await db.auditLog.count({ where: { userId: checker.id, action: "destination_change_approved" } })).toBeGreaterThanOrEqual(1);
    // A second decision on the same request is refused, so it cannot be applied twice.
    await expect(svc.decideApproval(req.id, "APPROVED", undefined, checker)).rejects.toThrow(/already/);
  });

  it("a non-Admin cannot request or decide it, and a rejected request changes nothing", async () => {
    await expect(svc.requestApproval("CLOSED_LOOP_DESTINATION", { entity: "ClosedLoopDestination", entityId: "fake", payload: {} }, { id: `${P}admin1`, role: "MARKETING" })).rejects.toThrow(/Not authorized/);
    const req = await svc.requestApproval("CLOSED_LOOP_DESTINATION", { entity: "ClosedLoopDestination", entityId: "fake", payload: { destination: "fake", enabled: true, region: "global", allowedRegions: ["global", "elsewhere"], sendValue: true } }, { id: `${P}admin1`, role: "ADMIN" });
    await expect(svc.decideApproval(req.id, "APPROVED", undefined, { id: `${P}admin2`, role: "FINANCE" })).rejects.toThrow(/Not authorized/);
    await svc.decideApproval(req.id, "REJECTED", "Not yet", { id: `${P}admin2`, role: "ADMIN" });
    expect((await db.integrationConfig.findUniqueOrThrow({ where: { provider: "closedloop_fake" } })).settings).toMatchObject({ allowedRegions: ["global"], sendValue: false });
  });

  it("an approved consent wording becomes the notice new consent records quote; before approval it is not", async () => {
    expect(await applied.loadApprovedAdsNotice()).toBeNull();
    const text = "We may tell advertising platforms, using coded identifiers only, that you completed KYC or funded, so they can measure which ads work.";
    const req = await svc.requestApproval("CONSENT_POLICY_CHANGE", { entity: "ClosedLoopConsentNotice", entityId: "ADS_MEASUREMENT", payload: { purpose: "ADS_MEASUREMENT", text, version: "2027-04" } }, { id: `${P}admin1`, role: "ADMIN" });
    expect(await applied.loadApprovedAdsNotice()).toBeNull();
    await svc.decideApproval(req.id, "APPROVED", "Compliance signed off", { id: `${P}admin2`, role: "ADMIN" });
    expect(await applied.loadApprovedAdsNotice()).toEqual({ text, version: "2027-04" });
  });
});

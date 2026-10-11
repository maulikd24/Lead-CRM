/**
 * Closed-loop conversions against a real database, with an injected fake fetch (no network, no real credentials). Skipped
 * unless CLOSEDLOOP_DB_TEST=1 and the database is local:
 *   CLOSEDLOOP_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch db> npx vitest run src/lib/closedloop/closedloop.db.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ auth: async () => null }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.CLOSEDLOOP_DB_TEST === "1" && local;
const ENV = { CLOSED_LOOP_CONVERSIONS_ENABLED: "1" } as Record<string, string>;
const NOW = new Date("2027-03-20T10:00:00Z");

describe.skipIf(!enabled)("closed-loop conversions against a real database", () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let job: typeof import("./job");
  let dbmod: typeof import("./db");
  const ids: Record<string, string> = {};
  const sent: { url: string; body: { data: { event_id: string; user_data: Record<string, unknown> }[] } }[] = [];
  const fetchImpl = async (u: string, init: { body?: string }) => {
    sent.push({ url: u, body: JSON.parse(init.body ?? "{}") });
    return { status: 200, ok: true, json: async () => ({ events_received: JSON.parse(init.body ?? "{}").data.length }) };
  };

  async function cleanup() {
    const cl = await db.client.findMany({ where: { clientCode: { startsWith: "CL3-" } }, select: { id: true } });
    const clientIds = cl.map((c) => c.id);
    await db.conversionOutbox.deleteMany({ where: { clientId: { in: clientIds } } });
    await db.consentRecord.deleteMany({ where: { clientId: { in: clientIds } } }).catch(() => undefined);
    await db.kycRecord.deleteMany({ where: { clientId: { in: clientIds } } });
    await db.fundingRecord.deleteMany({ where: { clientId: { in: clientIds } } });
    await db.client.deleteMany({ where: { id: { in: clientIds } } });
    await db.integrationConfig.deleteMany({ where: { provider: { startsWith: "closedloop_" } } });
  }

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = "11".repeat(32);
    ({ basePrisma: db } = await import("@/lib/db/prisma"));
    job = await import("./job");
    dbmod = await import("./db");
    await cleanup().catch(() => undefined);
    const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "Closed loop stage", sequence: 9320, slaHours: 24 } }));
    let n = 0;
    const mk = async (code: string, extra: object = {}) =>
      (ids[code] = (await db.client.create({ data: { clientCode: `CL3-${code}`, name: `Synthetic ${code}`, mobile: `98320${String(++n).padStart(5, "0")}`, email: `cl3-${code.toLowerCase()}@example.test`, currentStageId: stage.id, ...extra } })).id);
    await mk("A", { leadAttribution: { fbclid: "FBCLID1", gclid: "GCLID1", campaign: "Spring SIP" } });
    await mk("B"); // never consented
    await mk("C"); // consented then withdrawn before the send
    await mk("D", { isDeleted: true });
    await mk("E", { mergedIntoId: "someone" });
    for (const c of ["A", "B", "C", "D", "E"]) {
      await db.kycRecord.create({ data: { clientId: ids[c], status: "APPROVED", completionDate: new Date("2027-03-19T08:00:00Z") } });
    }
    await db.fundingRecord.create({ data: { clientId: ids.A, status: "FULLY_FUNDED", amount: 250000, fundingDate: new Date("2027-03-19T09:00:00Z") } });
    await db.fundingRecord.create({ data: { clientId: ids.B, status: "PARTIALLY_FUNDED", amount: 100000, fundingDate: new Date("2027-03-19T09:00:00Z") } });
    for (const c of ["A", "C", "D", "E"]) await db.consentRecord.create({ data: { clientId: ids[c], purpose: "ADS_MEASUREMENT", status: "GRANTED", source: "RM_RECORDED", reason: "test", capturedAt: new Date("2026-01-01T00:00:00Z") } });
  });
  afterAll(async () => {
    if (db) {
      await cleanup();
      await db.$disconnect();
    }
  });
  beforeEach(() => {
    sent.length = 0;
  });

  async function setUpMeta(extra: object = {}) {
    const { encryptJson } = await import("@/lib/security/crypto");
    await db.integrationConfig.upsert({
      where: { provider: "closedloop_meta_capi" },
      update: { credentials: encryptJson({ pixelId: "999", accessToken: "synthetic-token" }), settings: { enabled: true, region: "global", allowedRegions: ["global"], ...extra } },
      create: { provider: "closedloop_meta_capi", credentials: encryptJson({ pixelId: "999", accessToken: "synthetic-token" }), settings: { enabled: true, region: "global", allowedRegions: ["global"], ...extra } },
    });
  }

  it("candidates: only customers who ever consented, never deleted or merged-away records", async () => {
    const c = await dbmod.loadCandidates(NOW, { lookbackDays: 7, bands: false });
    const codes = c.map((x) => x.facts.clientId).filter((id) => Object.values(ids).includes(id));
    expect(codes.sort()).toEqual([ids.A, ids.C].sort());
  });

  it("with the region unapproved nothing leaves, and the rows wait", async () => {
    await setUpMeta({ allowedRegions: [] });
    const r = await job.runClosedLoopJob({ env: ENV, fetchImpl, now: () => NOW });
    expect(r).toMatchObject({ drained: { sent: 0, held: { REGION_BLOCKED: 3 } } });
    expect(sent).toHaveLength(0);
  });

  it("a withdrawal before the send skips that customer; the consented customer's events go once, hashed", async () => {
    await setUpMeta();
    await db.consentRecord.create({ data: { clientId: ids.C, purpose: "ADS_MEASUREMENT", status: "WITHDRAWN", source: "RM_RECORDED", reason: "test", capturedAt: new Date("2027-03-19T12:00:00Z") } });
    const r = await job.runClosedLoopJob({ env: ENV, fetchImpl, now: () => NOW });
    expect(r).toMatchObject({ drained: { sent: 2 } });
    const events = sent.flatMap((s) => s.body.data);
    expect(events).toHaveLength(2);
    const text = JSON.stringify(sent.map((x) => x.body.data));
    expect(text).not.toMatch(/Synthetic|cl3-a|98320|@example/i);
    expect(events[0].user_data.em).toBeTruthy();
    const rows = await db.conversionOutbox.findMany({ where: { clientId: { in: Object.values(ids) } } });
    expect(rows.filter((x) => x.clientId === ids.A).every((x) => x.status === "SENT")).toBe(true);
    // C: KYC at 08:00 was inside its consent window, but the withdrawal came before the send, so it never leaves.
    expect(rows.filter((x) => x.clientId === ids.C).every((x) => x.status === "SKIPPED" && x.reason === "CONSENT_WITHDRAWN")).toBe(true);
    expect(rows.some((x) => x.clientId === ids.B)).toBe(false);
  });

  it("running the job again sends nothing and creates nothing (idempotent)", async () => {
    const before = await db.conversionOutbox.count({ where: { clientId: { in: Object.values(ids) } } });
    await job.runClosedLoopJob({ env: ENV, fetchImpl, now: () => NOW });
    expect(sent).toHaveLength(0);
    expect(await db.conversionOutbox.count({ where: { clientId: { in: Object.values(ids) } } })).toBe(before);
  });

  it("the flag off does nothing at all", async () => {
    expect(await job.runClosedLoopJob({ env: {}, fetchImpl, now: () => NOW })).toEqual({ skipped: "flag off" });
  });

  it("two overlapping runs cannot both claim a row", async () => {
    const store = dbmod.createPrismaOutbox();
    await store.insertIfAbsent({ clientId: ids.A, destination: "meta_capi", eventType: "AUM_BAND", qualifier: "10L", dedupId: "cl1_race", occurredAt: NOW, identity: { hashedEmail: "a".repeat(64) }, value: null }, NOW);
    const row = (await db.conversionOutbox.findFirstOrThrow({ where: { dedupId: "cl1_race" } }));
    const stale = new Date(NOW.getTime() - 600_000);
    const results = await Promise.all([store.claim(row.id, NOW, stale), store.claim(row.id, NOW, stale), store.claim(row.id, NOW, stale)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("withdrawing cancels unsent rows of that customer only", async () => {
    const store = dbmod.createPrismaOutbox();
    await store.insertIfAbsent({ clientId: ids.B, destination: "meta_capi", eventType: "KYC_COMPLETE", qualifier: "", dedupId: "cl1_cancel", occurredAt: NOW, identity: { hashedEmail: "a".repeat(64) }, value: null }, NOW);
    expect(await store.cancelUnsentForClient(ids.B, "CONSENT_WITHDRAWN")).toBe(1);
    expect(await store.cancelUnsentForClient(ids.E, "CONSENT_WITHDRAWN")).toBe(0); // no rows
  });

  it("coverage by campaign and the overview count consented against not-consented funded customers, aggregates only", async () => {
    const views = await import("./views-db");
    const coverage = await views.loadCoverageByCampaign();
    const spring = coverage.find((r) => r.campaign === "Spring SIP")!;
    expect(spring).toMatchObject({ funded: 1, consented: 1, sendable: 1, share: 1, small: true });
    const none = coverage.find((r) => r.campaign === "No campaign recorded")!;
    expect(none.funded).toBeGreaterThanOrEqual(1);
    expect(none.consented).toBe(0);
    const overview = await views.loadOverview();
    expect(overview.funded.funded).toBe(overview.funded.consented + overview.funded.notConsented);
    expect(overview.statuses.sent).toBeGreaterThanOrEqual(2);
    expect(overview.match).toBeNull(); // Meta does not report a match per event, so no rate is shown
    const out = await views.loadOutbox("sent");
    expect(JSON.stringify([coverage, overview, out])).not.toMatch(/Synthetic|example\.test|98320|CL3-/);
    expect(out.rows.every((r) => r.ref.length === 8)).toBe(true);
  });
});

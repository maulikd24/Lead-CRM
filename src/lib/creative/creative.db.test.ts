/**
 * Real-database test for the creative and director modules. Needs a throwaway local Postgres, so it is skipped unless
 * CREATIVE_DB_TEST=1 (and it refuses any non-local database):
 *   CREATIVE_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch db> npx vitest run src/lib/creative/creative.db.test.ts
 * Run it on its own, one file at a time.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.CREATIVE_DB_TEST === "1" && local;

// Synthetic probes. Nothing here is a real person.
const NAME = "Zyxwv Quillonford";
const PHONE = "9876501234";
const EMAIL = "zyxwv.quillonford@example.test";
const PAN = "QZYXW1234K";

describe.skipIf(!enabled)("creative and director modules on a real database", () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let adminId = "";
  let otherId = "";

  beforeAll(async () => {
    ({ basePrisma: db } = await import("@/lib/db/prisma"));
    await clean();
    adminId = (await db.user.upsert({ where: { id: "cr-test-admin" }, update: { role: "ADMIN" }, create: { id: "cr-test-admin", name: "Creative Admin", email: "cr-admin@example.test", passwordHash: "x", role: "ADMIN" } })).id;
    otherId = (await db.user.upsert({ where: { id: "cr-test-mkt" }, update: { role: "MARKETING" }, create: { id: "cr-test-mkt", name: "Creative Marketer", email: "cr-mkt@example.test", passwordHash: "x", role: "MARKETING" } })).id;
  });
  afterAll(async () => {
    await clean();
    await db?.$disconnect();
  });
  async function clean() {
    if (!db) return;
    await db.creativeBrief.deleteMany({});
    await db.reportShare.deleteMany({});
    await db.directorDigest.deleteMany({});
    await db.creativeSetting.deleteMany({});
    await db.competitorWatch.deleteMany({});
    await db.client.deleteMany({ where: { clientCode: { startsWith: "CRT-" } } });
  }

  it("the MARKETING role exists in the database", async () => {
    expect((await db.user.findUniqueOrThrow({ where: { id: otherId } })).role).toBe("MARKETING");
  });

  it("a brief goes from draft to approved through the real store, and a stale write loses", async () => {
    const { creativeService } = await import("./store");
    const { briefInputSchema, generateKit } = await import("./kit");
    const { DEFAULT_BRAND_PROFILE } = await import("./brand");
    const svc = creativeService();
    const input = briefInputSchema.parse({ title: "DB brief", topic: "opening a demat account", audience: "first-time investors", language: "en", hookType: "question", formats: ["meta_feed"] });
    const made = await svc.createFromKit({ input, kit: generateKit(input, DEFAULT_BRAND_PROFILE), source: "STAFF", actor: { id: otherId, role: "MARKETING" } });
    if (!made.ok) throw new Error(made.error);
    const v = await db.creativeVariant.findFirstOrThrow({ where: { briefId: made.briefId } });
    expect(v).toMatchObject({ status: "DRAFT", complianceStatus: "PASS" });
    expect((await svc.transition(v.id, "submit", { id: otherId, role: "MARKETING" })).ok).toBe(true);
    expect(await svc.transition(v.id, "approve", { id: otherId, role: "MARKETING" }, { confirmed: true })).toMatchObject({ ok: false });
    expect((await svc.transition(v.id, "approve", { id: adminId, role: "ADMIN" }, { confirmed: true })).ok).toBe(true);
    expect((await db.creativeVariant.findUniqueOrThrow({ where: { id: v.id } })).status).toBe("APPROVED");
    expect(await db.auditLog.count({ where: { entity: "CreativeVariant", entityId: v.id, action: "creative_variant_approved" } })).toBe(1);
    expect(await db.creativeEvent.count({ where: { variantId: v.id } })).toBeGreaterThanOrEqual(3);
    // A manager is refused by the service itself.
    expect(await svc.transition(v.id, "request_changes", { id: "x", role: "MANAGER" }, { note: "n" })).toMatchObject({ ok: false });
    // Compare-and-set: moving from a status the row no longer has changes nothing.
    const { prismaCreativeStore } = await import("./store");
    expect(await prismaCreativeStore.casUpdateVariant(v.id, "DRAFT", { status: "NEEDS_REVIEW" })).toBe(false);
    // An approved brief cannot be deleted.
    expect(await svc.discardBrief(made.briefId, { id: adminId, role: "ADMIN" })).toMatchObject({ ok: false });
  });

  it("brand profile versions go up and the newest wins", async () => {
    const { saveBrandProfile, loadBrandProfile } = await import("./store");
    const { DEFAULT_BRAND_PROFILE } = await import("./brand");
    expect((await loadBrandProfile()).version).toBe(0);
    const a = await saveBrandProfile(DEFAULT_BRAND_PROFILE, adminId);
    const b = await saveBrandProfile({ ...DEFAULT_BRAND_PROFILE, regulatedClaims: ["tax saving"] }, adminId);
    expect(a).toEqual({ ok: true, version: 1 });
    expect(b).toEqual({ ok: true, version: 2 });
    const now = await loadBrandProfile();
    expect(now.version).toBe(2);
    expect(now.profile.regulatedClaims).toEqual(["tax saving"]);
    expect(await saveBrandProfile({ tone: {} }, adminId)).toMatchObject({ ok: false });
  });

  it("a share link: only the hash is stored, it opens, counts a view, expires and revokes, and the snapshot holds no customer data", async () => {
    const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "CRT stage", sequence: 9101, slaHours: 24 } }));
    await db.client.create({ data: { clientCode: "CRT-0001", name: NAME, mobile: PHONE, email: EMAIL, pan: PAN, currentStageId: stage.id, leadAttribution: { utm_source: "facebook", campaign: "Demat basics", name: NAME } } });
    const { loadDirectorReport, createShare, openShare, revokeShare, listShares } = await import("@/lib/director/db");
    const now = new Date("2026-10-12T04:00:00Z");
    const report = await loadDirectorReport("2026-10-05", "2026-10-11", now);
    const share = await createShare({ report, userId: adminId, expiryDays: 7, now });
    const row = await db.reportShare.findUniqueOrThrow({ where: { id: share.id } });
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(share.token);
    const dump = JSON.stringify(row.snapshot);
    for (const probe of [NAME, "Quillonford", PHONE, EMAIL, PAN]) expect(dump).not.toContain(probe);

    expect((await openShare(share.token, new Date("2026-10-13T00:00:00Z"))).state).toBe("open");
    expect((await db.reportShare.findUniqueOrThrow({ where: { id: share.id } })).viewCount).toBe(1);
    expect((await openShare("x".repeat(43), now)).state).toBe("not_found");
    expect((await openShare("bad", now)).state).toBe("not_found");
    expect((await openShare(share.token, new Date("2026-10-20T00:00:00Z"))).state).toBe("expired");
    expect(await revokeShare(share.id, adminId)).toBe(true);
    expect((await openShare(share.token, new Date("2026-10-13T00:00:00Z"))).state).toBe("revoked");
    expect(await revokeShare(share.id, adminId)).toBe(false);
    expect((await listShares(new Date("2026-10-13T00:00:00Z")))[0].state).toBe("revoked");
    expect(await db.auditLog.count({ where: { entity: "ReportShare", entityId: share.id } })).toBe(2);
  });

  it("the weekly digest: nothing unless flagged and switched on, one draft per week, never sent, notifies only recipients who are users", async () => {
    const { runWeeklyDigest, approveDigest } = await import("@/lib/director/db");
    const { saveDigestSettings } = await import("./settings");
    const monday = new Date("2026-10-12T03:00:00Z");
    expect(await runWeeklyDigest(monday, {})).toEqual({ skipped: "flag off" });
    const on = { DIRECTOR_REPORTS_ENABLED: "1" };
    expect(await runWeeklyDigest(monday, on)).toEqual({ skipped: "digest off in settings" });
    await saveDigestSettings({ enabled: true, recipients: ["cr-admin@example.test", "outside.person@example.test"] }, adminId);
    expect(await runWeeklyDigest(new Date("2026-10-12T00:30:00Z"), on)).toEqual({ skipped: "not due" });

    const r = await runWeeklyDigest(monday, on);
    expect(r).toEqual({ created: "2026-10-05", notified: 1 });
    expect(await runWeeklyDigest(monday, on)).toEqual({ skipped: "not due" });
    const d = await db.directorDigest.findFirstOrThrow({});
    expect(d.status).toBe("DRAFT");
    expect(d.bodyText).toMatch(/DRAFT FOR APPROVAL/);
    expect(d.recipients).toEqual(["cr-admin@example.test", "outside.person@example.test"]);
    expect(await db.notification.count({ where: { userId: adminId, type: "marketing_weekly_digest" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: otherId, type: "marketing_weekly_digest" } })).toBe(0);
    expect(await approveDigest(d.id, adminId)).toBe(true);
    expect(await approveDigest(d.id, adminId)).toBe(false);
    await db.notification.deleteMany({ where: { type: "marketing_weekly_digest" } });
  });

  it("competitor CSV import: duplicates skipped, bad rows reported, no network", async () => {
    const { importCsv, listCompetitorAds } = await import("./competitor-db");
    const csv = "competitor,copy,format,start_date,link,thumbnail_ref\nRival,Is your portfolio working?,video,2026-08-01,https://example.com/a,thumb-1\nRival,Is your portfolio working?,video,2026-08-01,https://example.com/a,thumb-1\nRival,,video,,,\n";
    const r = await importCsv(csv, adminId);
    expect(r.added).toBe(1);
    expect(r.duplicates).toBe(1);
    expect(r.errors).toHaveLength(1);
    const ads = await listCompetitorAds();
    expect(ads[0]).toMatchObject({ hookTag: "question", tagStatus: "DRAFT", tagSource: "RULE" });
  });

  it("tags: a suggestion never overwrites a confirmed tag", async () => {
    const { setTag, saveSuggestedTags, loadTags } = await import("./tags-db");
    await setTag({ channel: "google", adId: "ad-1", adName: "Ad", type: "hook", value: "process", userId: adminId });
    await saveSuggestedTags({ channel: "google", adId: "ad-1", adName: "Ad" }, { hook: "question", format: "video" }, "RULE");
    const t = (await loadTags(["google:ad-1"])).get("google:ad-1")!;
    expect(t.tags).toEqual({ hook: "process", format: "video" });
    expect(t.status).toBe("DRAFT");
  });
});

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
    await db.brandProfileVersion.deleteMany({});
    await db.creativeTag.deleteMany({});
    await db.experiment.deleteMany({});
    await db.competitorWatch.deleteMany({});
    await dropProbeClients();
  }
  async function dropProbeClients() {
    const ids = (await db.client.findMany({ where: { clientCode: { startsWith: "CRT-" } }, select: { id: true } })).map((c) => c.id);
    await db.clientPayment.deleteMany({ where: { clientId: { in: ids } } });
    await db.fundingRecord.deleteMany({ where: { clientId: { in: ids } } });
    await db.kycRecord.deleteMany({ where: { clientId: { in: ids } } });
    await db.client.deleteMany({ where: { id: { in: ids } } });
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

  it("a share link: only the hash is stored, it opens only once approved, counts a view, expires and revokes, and the snapshot holds no customer data", async () => {
    const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "CRT stage", sequence: 9101, slaHours: 24 } }));
    await db.client.create({ data: { clientCode: "CRT-0001", name: NAME, mobile: PHONE, email: EMAIL, pan: PAN, currentStageId: stage.id, leadAttribution: { utm_source: "facebook", campaign: "Demat basics", name: NAME } } });
    const { loadDirectorReport, createShare, decideShare, openShare, revokeShare, listShares } = await import("@/lib/director/db");
    const now = new Date("2026-10-12T04:00:00Z");
    const report = await loadDirectorReport("2026-10-05", "2026-10-11", now);
    const share = await createShare({ report, userId: adminId, expiryDays: 7, now });
    const row = await db.reportShare.findUniqueOrThrow({ where: { id: share.id } });
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row).toMatchObject({ awaitingApproval: true, approvedAt: null });
    expect(JSON.stringify(row)).not.toContain(share.token);
    const dump = JSON.stringify(row.snapshot);
    for (const probe of [NAME, "Quillonford", PHONE, EMAIL, PAN]) expect(dump).not.toContain(probe);

    // Until a person approves, the link opens nothing and looks exactly like a link that was never issued.
    expect((await openShare(share.token, new Date("2026-10-13T00:00:00Z"))).state).toBe("not_found");
    expect((await db.reportShare.findUniqueOrThrow({ where: { id: share.id } })).viewCount).toBe(0);
    expect(await revokeShare(share.id, adminId)).toBe(false); // a pending link is declined, not revoked
    expect(await decideShare({ id: share.id, actorId: otherId, decision: "approve", confirmed: false, now })).toMatchObject({ ok: false });
    expect(await decideShare({ id: share.id, actorId: otherId, decision: "approve", confirmed: true, now })).toEqual({ ok: true, decision: "approve" });
    expect(await decideShare({ id: share.id, actorId: adminId, decision: "approve", confirmed: true, now })).toMatchObject({ ok: false });

    expect((await openShare(share.token, new Date("2026-10-13T00:00:00Z"))).state).toBe("open");
    expect((await db.reportShare.findUniqueOrThrow({ where: { id: share.id } })).viewCount).toBe(1);
    expect((await openShare("x".repeat(43), now)).state).toBe("not_found");
    expect((await openShare("bad", now)).state).toBe("not_found");
    expect((await openShare(share.token, new Date("2026-10-20T00:00:00Z"))).state).toBe("expired");
    expect(await revokeShare(share.id, adminId)).toBe(true);
    expect((await openShare(share.token, new Date("2026-10-13T00:00:00Z"))).state).toBe("revoked");
    expect(await revokeShare(share.id, adminId)).toBe(false);
    expect((await listShares(new Date("2026-10-13T00:00:00Z")))[0].state).toBe("revoked");
    expect((await db.auditLog.findMany({ where: { entity: "ReportShare", entityId: share.id }, select: { action: true }, orderBy: { seq: "asc" } })).map((a) => a.action)).toEqual(["report_share_requested", "report_share_approved", "report_share_revoked"]);
  });

  it("a declined link never opens, with the reason kept; with four eyes on, the maker cannot approve their own link", async () => {
    const { createShare, decideShare, openShare, loadDirectorReport } = await import("@/lib/director/db");
    const { saveApprovalSettings } = await import("./settings");
    const now = new Date("2026-10-12T04:00:00Z");
    const report = await loadDirectorReport("2026-10-05", "2026-10-11", now);
    const declined = await createShare({ report, userId: adminId, expiryDays: 7, now });
    expect(await decideShare({ id: declined.id, actorId: otherId, decision: "decline", reason: "", now })).toMatchObject({ ok: false });
    expect(await decideShare({ id: declined.id, actorId: otherId, decision: "decline", reason: "Numbers look off", now })).toEqual({ ok: true, decision: "decline" });
    expect(await db.reportShare.findUniqueOrThrow({ where: { id: declined.id } })).toMatchObject({ awaitingApproval: false, decisionNote: "Numbers look off", approvedAt: null });
    expect((await openShare(declined.token, now)).state).toBe("revoked");
    expect(await decideShare({ id: declined.id, actorId: otherId, decision: "approve", confirmed: true, now })).toMatchObject({ ok: false });

    await saveApprovalSettings({ adCreativeFourEyes: true, reportFourEyes: true }, adminId);
    const mine = await createShare({ report, userId: adminId, expiryDays: 7, now });
    expect(await decideShare({ id: mine.id, actorId: adminId, decision: "approve", confirmed: true, now })).toMatchObject({ ok: false, error: expect.stringMatching(/second person/i) });
    expect((await openShare(mine.token, now)).state).toBe("not_found");
    expect(await decideShare({ id: mine.id, actorId: otherId, decision: "approve", confirmed: true, now })).toMatchObject({ ok: true });
    expect((await openShare(mine.token, now)).state).toBe("open");
    await saveApprovalSettings({ adCreativeFourEyes: true, reportFourEyes: false }, adminId);
  });

  it("two people deciding one link at once: exactly one wins", async () => {
    const { createShare, decideShare, loadDirectorReport } = await import("@/lib/director/db");
    const now = new Date("2026-10-12T04:00:00Z");
    const s = await createShare({ report: await loadDirectorReport("2026-10-05", "2026-10-11", now), userId: adminId, expiryDays: 7, now });
    const results = await Promise.all([decideShare({ id: s.id, actorId: otherId, decision: "approve", confirmed: true, now }), decideShare({ id: s.id, actorId: adminId, decision: "approve", confirmed: true, now })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("the report's numbers are the canonical outcome provider's (no customer query of its own)", async () => {
    const { loadDirectorReport } = await import("@/lib/director/db");
    const { getCampaignOutcomeProvider } = await import("@/lib/attribution");
    const now = new Date("2026-10-12T04:00:00Z");
    const [report, canon] = await Promise.all([loadDirectorReport("2026-10-05", "2026-10-11", now), getCampaignOutcomeProvider().outcomes({ grain: "campaign", period: { from: "2026-10-05", to: "2026-10-11" } }, { kind: "system", consumer: "director-reports" })]);
    for (const c of canon.byChannel) {
      const ch = report.channels.find((x) => x.channel === c.channel);
      if (!ch || !c.available) continue;
      expect(ch.current.funded, c.channel).toBe(c.funded);
      expect(ch.current.revenue, c.channel).toBe(c.revenue);
      expect(ch.current.costPerFunded, c.channel).toBe(c.costPerFunded);
    }
    expect(report.totals.current.costPerFunded).toBe(canon.paid.costPerFunded);
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

  it("events go through emit(): drafted, submitted, approved, shared and the digest steps are stored once, with no customer, sharing one flow and naming their cause", async () => {
    process.env.CUSTOMER_EVENTS_ENABLED = "1";
    try {
      await db.customerEvent.deleteMany({ where: { eventType: { startsWith: "campaign.creative." } } });
      await db.customerEvent.deleteMany({ where: { eventType: { startsWith: "campaign.report." } } });
      const { creativeService } = await import("./store");
      const { briefInputSchema, generateKit } = await import("./kit");
      const { DEFAULT_BRAND_PROFILE } = await import("./brand");
      const svc = creativeService();
      const input = briefInputSchema.parse({ title: "Event brief", topic: "opening a demat account", audience: "first-time investors", language: "en", hookType: "question", formats: ["meta_feed"] });
      const made = await svc.createFromKit({ input, kit: generateKit(input, DEFAULT_BRAND_PROFILE), source: "AI", actor: { id: otherId, role: "MARKETING" } });
      if (!made.ok) throw new Error(made.error);
      const v = await db.creativeVariant.findFirstOrThrow({ where: { briefId: made.briefId } });
      await svc.transition(v.id, "submit", { id: otherId, role: "MARKETING" });
      await svc.transition(v.id, "approve", { id: adminId, role: "ADMIN" }, { confirmed: true });
      const rows = await db.customerEvent.findMany({ where: { eventType: { startsWith: "campaign.creative." } }, orderBy: { seq: "asc" } });
      expect(rows.map((r) => r.eventType)).toEqual(["campaign.creative.drafted", "campaign.creative.submitted", "campaign.creative.approved"]);
      expect(rows.every((r) => r.clientId === null && r.dataClass === "INTERNAL")).toBe(true);
      expect(new Set(rows.map((r) => r.correlationId)).size).toBe(1);
      expect(rows[1].causationId).toBe(rows[0].eventId);
      expect(rows[0].metadata).toMatchObject({ briefId: made.briefId, source: "AI", variants: 1 });
      expect(JSON.stringify(rows.map((r) => r.metadata))).not.toMatch(/demat|Event brief|first-time/i);
      expect(rows[2].actorId).toBe(adminId);

      const { loadDirectorReport, createShare, decideShare, revokeShare, runWeeklyDigest, approveDigest, discardDigest } = await import("@/lib/director/db");
      const { saveDigestSettings } = await import("./settings");
      const now = new Date("2026-10-12T04:00:00Z");
      const share = await createShare({ report: await loadDirectorReport("2026-10-05", "2026-10-11", now), userId: adminId, expiryDays: 7, now });
      expect(await db.customerEvent.count({ where: { eventType: "campaign.report.shared" } })).toBe(0); // nothing is published until it is approved
      await decideShare({ id: share.id, actorId: otherId, decision: "approve", confirmed: true, now });
      await revokeShare(share.id, adminId, now);
      await saveDigestSettings({ enabled: true, recipients: ["cr-admin@example.test"] }, adminId);
      await db.directorDigest.deleteMany({});
      const monday = new Date("2026-10-12T03:00:00Z");
      await runWeeklyDigest(monday, { DIRECTOR_REPORTS_ENABLED: "1" });
      const d = await db.directorDigest.findFirstOrThrow({});
      await approveDigest(d.id, adminId);
      const reportEvents = await db.customerEvent.findMany({ where: { eventType: { startsWith: "campaign.report." } }, orderBy: { seq: "asc" } });
      expect(reportEvents.map((r) => r.eventType)).toEqual(["campaign.report.shared", "campaign.report.share.revoked", "campaign.report.digest.prepared", "campaign.report.digest.approved"]);
      expect(reportEvents[1].causationId).toBe(reportEvents[0].eventId);
      expect(reportEvents[3].causationId).toBe(reportEvents[2].eventId);
      expect(reportEvents[2].actorType).toBe("system");
      expect(JSON.stringify(reportEvents.map((r) => r.metadata))).not.toMatch(/token|http/i);
      // Replays store nothing new: discarding an approved digest does not happen, and the same step twice is one row.
      expect(await discardDigest(d.id, adminId)).toBe(false);
      expect(await db.customerEvent.count({ where: { eventType: { startsWith: "campaign.report." } } })).toBe(4);
    } finally {
      delete process.env.CUSTOMER_EVENTS_ENABLED;
      await db.customerEvent.deleteMany({ where: { OR: [{ eventType: { startsWith: "campaign.creative." } }, { eventType: { startsWith: "campaign.report." } }] } });
      await db.notification.deleteMany({ where: { type: "marketing_weekly_digest" } });
    }
  }, 90_000);

  it("canonical approvals over the real tables: the same outcome as the legacy path for an ad variant, a report link and a digest", async () => {
    const { approvalService } = await import("@/lib/policy/approvals/canonical/wiring");
    const { creativeService } = await import("./store");
    const { briefInputSchema, generateKit } = await import("./kit");
    const { DEFAULT_BRAND_PROFILE } = await import("./brand");
    const svc = creativeService();
    const canon = approvalService();
    const marketer = { id: otherId, role: "MARKETING" } as const;
    const admin = { id: adminId, role: "ADMIN" } as const;
    const input = briefInputSchema.parse({ title: "Canonical brief", topic: "opening a demat account", audience: "first-time investors", language: "en", hookType: "question", formats: ["meta_feed"] });
    const make = async () => {
      const made = await svc.createFromKit({ input, kit: generateKit(input, DEFAULT_BRAND_PROFILE), source: "STAFF", actor: marketer });
      if (!made.ok) throw new Error(made.error);
      const v = await db.creativeVariant.findFirstOrThrow({ where: { briefId: made.briefId } });
      await svc.transition(v.id, "submit", marketer);
      return v.id;
    };
    const [legacyId, canonId, blockedId] = [await make(), await make(), await make()];
    const state = async (id: string) => { const r = await db.creativeVariant.findUniqueOrThrow({ where: { id } }); return { status: r.status, approvedById: r.approvedById, reviewNote: r.reviewNote }; };
    // approve
    expect((await svc.transition(legacyId, "approve", admin, { confirmed: true })).ok).toBe(true);
    expect(await canon.decide(admin as never, `ad-creative:${canonId}`, "approve", { params: { confirmed: true } })).toMatchObject({ ok: true, state: "approved" });
    expect(await state(canonId)).toEqual(await state(legacyId));
    // the author cannot approve their own copy (setting on by default), through either door
    expect(await canon.decide(marketer as never, `ad-creative:${blockedId}`, "approve", { params: { confirmed: true } })).toMatchObject({ ok: false, code: "SELF_APPROVAL" });
    expect((await state(blockedId)).status).toBe("NEEDS_REVIEW");
    // reject = request changes
    expect(await canon.decide(admin as never, `ad-creative:${blockedId}`, "reject", { reason: "Shorten it", params: {} })).toMatchObject({ ok: true, state: "rejected" });
    expect(await state(blockedId)).toMatchObject({ status: "DRAFT", reviewNote: "Shorten it" });
    // MARKETING sees the awaiting list; the others do not
    expect((await canon.listFor(marketer as never, { tab: "awaiting" })).items.every((i) => ["ad-creative", "director-report", "social-post"].includes(i.kind))).toBe(true);
    expect((await canon.listFor({ id: "x", role: "RM" } as never, { tab: "awaiting" })).items.filter((i) => i.kind === "ad-creative" || i.kind === "director-report")).toEqual([]);

    // report link and digest
    const { createShare, loadDirectorReport, openShare, runWeeklyDigest } = await import("@/lib/director/db");
    const { saveDigestSettings } = await import("./settings");
    const now = new Date();
    const share = await createShare({ report: await loadDirectorReport("2026-10-05", "2026-10-11", now), userId: adminId, expiryDays: 7, now });
    expect((await canon.listFor(marketer as never, { tab: "awaiting" })).items.map((i) => i.ref)).toContain(`director-report:share:${share.id}`);
    expect(await canon.decide(marketer as never, `director-report:share:${share.id}`, "approve", { params: {} })).toMatchObject({ ok: false, code: "NEEDS_INPUT" });
    expect(await canon.decide(marketer as never, `director-report:share:${share.id}`, "approve", { params: { confirmed: true } })).toMatchObject({ ok: true, state: "approved" });
    expect((await openShare(share.token, now)).state).toBe("open");
    await saveDigestSettings({ enabled: true, recipients: [] }, adminId);
    await db.directorDigest.deleteMany({});
    await runWeeklyDigest(new Date("2026-10-12T03:00:00Z"), { DIRECTOR_REPORTS_ENABLED: "1" });
    const d = await db.directorDigest.findFirstOrThrow({});
    expect(await canon.decide(admin as never, `director-report:digest:${d.id}`, "reject", { reason: "Not this week", params: {} })).toMatchObject({ ok: true, state: "rejected" });
    expect((await db.directorDigest.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("DISCARDED");
    await db.notification.deleteMany({ where: { type: "marketing_weekly_digest" } });
  }, 90_000);

  it("creative insights and the experiments view read the canonical outcome provider: the same funded customers and cost per funded customer, and an RM is refused", async () => {
    const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "CRT stage", sequence: 9101, slaHours: 24 } }));
    const ACCT = "crt-acct";
    const NOW = new Date("2027-04-20T06:00:00Z");
    await db.adCreativeDaily.deleteMany({ where: { accountId: ACCT } });
    await db.adCampaignDaily.deleteMany({ where: { accountId: ACCT } });
    await db.adSyncRun.deleteMany({ where: { accountId: ACCT } });
    await dropProbeClients();
    try {
      for (let d = 0; d < 28; d++) {
        const date = new Date(Date.UTC(2027, 3, 20 - d));
        await db.adCampaignDaily.create({ data: { provider: "google", accountId: ACCT, campaignId: "9100", campaignName: "GCreative Test", date, spendMinor: 100_000n, currency: "INR", impressions: 4000, clicks: 80, reach: 0, leads: 2, syncedAt: NOW } });
        await db.adCreativeDaily.create({ data: { provider: "google", accountId: ACCT, campaignId: "9100", campaignName: "GCreative Test", adId: "g-a1", adName: "GAd one", format: "RESPONSIVE_SEARCH_AD", date, spendMinor: 100_000n, currency: "INR", impressions: 4000, clicks: 80, leads: 2, syncedAt: NOW } });
      }
      await db.adSyncRun.create({ data: { provider: "google", accountId: ACCT, status: "SUCCESS", startedAt: new Date(NOW.getTime() - 3_600_000), finishedAt: NOW } });
      for (let i = 1; i <= 3; i++) {
        const c = await db.client.create({ data: { clientCode: `CRT-G${i}`, name: `Probe Person ${i}`, mobile: `900000030${i}`, currentStageId: stage.id, createdAt: new Date("2027-04-05T05:00:00Z"), leadSource: "Google Ads", leadAttribution: { utm_source: "google", gclid: `g${i}`, campaign_id: "9100", utm_campaign: "GCreative Test", utm_content: "GAd one" } } });
        if (i === 1) {
          await db.fundingRecord.create({ data: { clientId: c.id, status: "FULLY_FUNDED", amount: 100000, fundingDate: new Date("2027-04-08T05:00:00Z") } });
          await db.clientPayment.create({ data: { clientId: c.id, paymentType: "FUNDS_IN", amount: 100000, paidAt: new Date("2027-04-08T05:00:00Z"), status: "SUCCESS", sourceSystem: "test", externalRef: "crt-pay-1" } });
        }
      }
      const { loadInsights } = await import("./insights-db");
      const { loadExperimentsData } = await import("./experiments-view");
      const { getCampaignOutcomeProvider } = await import("@/lib/attribution");
      const admin = { id: adminId, role: "ADMIN" };
      const range = { from: "2027-04-01", to: "2027-04-20" };
      const canon = await getCampaignOutcomeProvider({ now: () => NOW }).outcomes({ grain: "ad", period: range }, { kind: "user", ...admin });
      const insights = await loadInsights(admin, range);
      const ad = insights.view.ads.find((a) => a.adName === "GAd one")!;
      expect(ad, JSON.stringify(insights.view.ads.map((a) => a.adName))).toBeDefined();
      const row = canon.rows.find((r) => r.key === "google:9100::GAd one")!;
      expect(row.leads).toBe(3);
      expect({ leads: ad.leads, funded: ad.funded, revenue: ad.revenue, spend: ad.spend, costPerFunded: ad.costPerFunded }).toEqual({ leads: row.leads, funded: row.funded, revenue: row.revenue, spend: row.spend, costPerFunded: row.costPerFunded });
      expect(ad.funded).toBe(1);
      expect(ad.impressions).toBe(4000 * 20);
      expect(ad.fatigue).not.toBeNull();
      expect(insights.view.fundedKnown).toBe(true);
      // The experiments view's lead-to-funded rate is the provider's.
      const ex = await loadExperimentsData(admin, "2027-04-20");
      const camp = await getCampaignOutcomeProvider({ now: () => NOW }).outcomes({ grain: "campaign", period: { from: "2027-01-22", to: "2027-04-20" } }, { kind: "user", ...admin });
      expect(ex.observed?.rate).toBe(camp.totals?.fundedRate);
      expect(ex.campaigns.map((c) => c.id)).toContain("google:9100");
      // An RM never reaches either loader's numbers.
      await expect(loadInsights({ id: "rm", role: "RM" }, range)).rejects.toThrow();
      expect(JSON.stringify(insights)).not.toMatch(/Probe Person|9000003/);
    } finally {
      await dropProbeClients();
      await db.adCreativeDaily.deleteMany({ where: { accountId: ACCT } });
      await db.adCampaignDaily.deleteMany({ where: { accountId: ACCT } });
      await db.adSyncRun.deleteMany({ where: { accountId: ACCT } });
    }
  }, 90_000);
});

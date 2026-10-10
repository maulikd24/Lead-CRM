/**
 * Real-database erasure test: seeds a synthetic customer with ledger rows and every trace this feature adds, runs the
 * real erasure action, then dumps EVERY table and asserts none of the person's identifiers survive anywhere.
 *
 * Needs a throwaway local Postgres, so it is skipped unless ERASURE_DB_TEST=1 (and refuses any non-local database):
 *   ERASURE_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch db> npx vitest run src/lib/privacy/erasure-pii.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn(async () => ({ user: { id: "erasure-test-admin", role: "ADMIN" } })) }));
vi.mock("@/lib/policy/approvals/service", () => ({ requestApproval: vi.fn() }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.ERASURE_DB_TEST === "1" && local;

// Synthetic, unique probes. Nothing here is a real person.
const NAME = "Zyxwv Quillonford";
const FIRST = "Zyxwv";
const PHONE = "9876501234";
const EMAIL = "zyxwv.quillonford@example.test";
const PAN = "QZYXW1234K";
const APP_ID = "app-user-zq-7781";
const OTHER_NAME = "Unrelated Person";
const PAN2 = "QZYXW9999K";
const PHONE_SPACED = "98765 01234";
const OTHER_DUP_NAME = "Bystander Duplicate";
const PROBES = [NAME, "Quillonford", FIRST, PHONE, PHONE_SPACED, EMAIL, PAN, PAN2, APP_ID];

describe.skipIf(!enabled)("client erasure leaves no personal data in any table", () => {
  let basePrisma: typeof import("@/lib/db/prisma").basePrisma;
  let executeClientErasureAction: typeof import("@/app/(dashboard)/settings/data-privacy/actions").executeClientErasureAction;
  let erasureRequestId = "";
  let survivorId = "";
  let otherLedgerId = "";
  let dup1Id = "";
  let dup2Id = "";
  let bystanderDupId = "";

  beforeAll(async () => {
    ({ basePrisma } = await import("@/lib/db/prisma"));
    ({ executeClientErasureAction } = await import("@/app/(dashboard)/settings/data-privacy/actions"));
    const db = basePrisma;
    await cleanup();

    const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "Erasure test stage", sequence: 9001, slaHours: 24 } }));
    const admin = await db.user.upsert({
      where: { id: "erasure-test-admin" },
      update: {},
      create: { id: "erasure-test-admin", name: "Erasure Admin", email: "erasure-admin@example.test", passwordHash: "x", role: "ADMIN" },
    });

    const survivor = await db.client.create({ data: { clientCode: "ZQ-SURV", name: OTHER_NAME, currentStageId: stage.id } });
    survivorId = survivor.id;
    const client = await db.client.create({
      data: { clientCode: "ZQ-0001", name: NAME, mobile: PHONE, email: EMAIL, pan: PAN, currentStageId: stage.id, mergedIntoId: survivor.id, notes: `Call ${NAME}`, leadAttribution: { externalId: APP_ID } },
    });
    const clientId = client.id;

    // Duplicates that were merged INTO the erased customer (and one merged into that duplicate): separate Client rows that keep
    // the same person's name, phone and email, plus their own children. A bystander duplicate of someone else must stay untouched.
    const dup1 = await db.client.create({
      data: { clientCode: "ZQ-DUP1", name: NAME, mobile: `+91 ${PHONE_SPACED}`, email: EMAIL.toUpperCase(), pan: PAN2, city: "Quillonford Nagar", currentStageId: stage.id, mergedIntoId: clientId, status: "NOT_PROCEEDING", notes: `Duplicate of ${NAME}`, leadAttribution: { externalId: APP_ID, name: NAME } },
    });
    const dup2 = await db.client.create({ data: { clientCode: "ZQ-DUP2", name: "Zyxwv Q.", mobile: PHONE, email: EMAIL, currentStageId: stage.id, mergedIntoId: dup1.id, status: "NOT_PROCEEDING", marketingConsentText: `I, ${NAME}, agree` } });
    const bystander = await db.client.create({ data: { clientCode: "ZQ-BYST", name: OTHER_DUP_NAME, mobile: "9000000001", currentStageId: stage.id, mergedIntoId: survivor.id, status: "NOT_PROCEEDING" } });
    dup1Id = dup1.id;
    dup2Id = dup2.id;
    bystanderDupId = bystander.id;
    await db.conversationReview.create({ data: { clientId: dup1.id, sourceType: "WHATSAPP_THREAD", transcript: `${NAME}: call me on ${PHONE}`, aiRawResponse: { quote: NAME } } });
    await db.activity.create({ data: { clientId: dup2.id, type: "NOTE", payload: { message: `Spoke to ${NAME}` } } });

    const payload = { raw: { name: NAME, phone: PHONE, email: EMAIL, userId: APP_ID }, normalized: { name: NAME, phone: PHONE, email: EMAIL, externalId: APP_ID } };
    await db.leadIntake.createMany({
      data: [
        { source: "allvest_app", externalId: APP_ID, status: "CREATED", clientId, rawPayload: payload },
        { source: "web", externalId: `web-${EMAIL}`, status: "DUPLICATE", clientId, rawPayload: payload, error: `bad value ${EMAIL}` },
        // Never linked to a client (rejected / failed): still holds the same person's contact details.
        { source: "web", externalId: "web-unlinked-1", status: "REJECTED", rawPayload: { raw: { email: EMAIL.toUpperCase(), name: NAME } }, error: `rejected ${PHONE}` },
        { source: "allvest_app", externalId: "app-user-other-1", status: "CREATED", clientId: survivor.id, rawPayload: { normalized: { name: OTHER_NAME } } },
      ],
    });
    otherLedgerId = (await db.leadIntake.findFirstOrThrow({ where: { externalId: "app-user-other-1" } })).id;

    await db.cleverTapSync.create({ data: { clientId, lastHash: "h", lastError: `failed for ${EMAIL}` } });
    await db.mergeSuggestion.create({ data: { clientAId: clientId, clientBId: survivor.id, score: 0.9, reasons: [`same phone ${PHONE}`] } });
    await db.notification.create({ data: { userId: admin.id, type: "lead_reenquiry", payload: { clientId, clientName: NAME, source: "web" } } });
    await db.notification.create({ data: { userId: admin.id, type: "lead_reenquiry", payload: { clientId: survivor.id, clientName: OTHER_NAME } } });
    // The merge note the survivor carries about this person (older merges wrote the name into it).
    await db.activity.create({ data: { clientId: survivor.id, type: "NOTE", payload: { message: `Merged duplicate client ${NAME} (ZQ-0001) into this record` } } });
    await db.activity.create({ data: { clientId: survivor.id, type: "NOTE", payload: { message: "Merged duplicate client Someone Else (ZQ-9999) into this record" } } });
    await db.activity.create({ data: { clientId, type: "NOTE", payload: { message: `Spoke to ${NAME}` } } });
    await db.message.create({ data: { clientId, channel: "WHATSAPP", provider: "x", direction: "INBOUND", body: `hi, ${NAME}`, metadata: { phone: PHONE } } });
    // Profiling / conversation tables from the earlier branches: all link to the client and may quote the person.
    await db.conversationInsight.create({ data: { clientId, kind: "INTEREST", text: `${NAME} wants a call on ${PHONE}`, sourceType: "NOTE", sourceRef: "n1", dedupeKey: "zq-dedupe-1", occurredAt: new Date() } });
    await db.conversationReview.create({ data: { clientId, sourceType: "WHATSAPP_THREAD", transcript: `${NAME}: please email ${EMAIL}`, aiRawResponse: { quote: NAME } } });
    await db.customerIntelligence.create({ data: { clientId, lifecycleStage: "x", nbaProgramme: "p", nbaAction: "Call", nbaReason: `${NAME} asked`, nbaPriority: "High", nbaOwner: "RM", nbaTiming: "Today", talkingPoints: [`ask ${NAME}`], situations: [], doNotDiscuss: [] } });
    await db.smartAllvestProfile.create({ data: { clientId, goals: [{ goal: `${NAME} retirement` }] } });
    await db.segmentMembership.create({ data: { clientId, segment: "zq" } });
    await db.interactionOutcome.create({ data: { clientId, outcome: "INTERESTED", channel: "CALL", actorType: "RM", note: `${NAME} said yes`, summary: `${NAME}` } });
    await db.assetClassAcceptance.create({ data: { clientId, assetClass: "PMS", level: "HIGH", source: "insight", reason: `${NAME} asked about PMS` } });
    await db.wealthHealthCheckup.create({ data: { clientId, keyFindings: `${NAME} holds too much cash` } });
    await db.opportunity.create({ data: { clientId, product: "PMS", estimatedValue: 1000, ownerId: admin.id } });
    // Customer outcomes and goals: free text the RM typed about the person, on the customer and on a merged duplicate of them.
    for (const holder of [clientId, dup1.id]) {
      await db.customerGoal.create({ data: { clientId: holder, name: `${NAME} retirement`, targetAmount: 5_000_000, targetDate: new Date("2040-01-01"), notes: `Call ${PHONE} about ${EMAIL}`, linkedAccountIds: [], linkedHoldingKeys: [] } });
      await db.customerReview.create({ data: { clientId: holder, note: `Reviewed with ${NAME}` } });
      await db.suggestionDismissal.create({ data: { clientId: holder, ruleKey: "idle_cash", fingerprint: "4", reason: `${NAME} said wait`, snoozeUntil: new Date("2030-01-01") } });
      await db.outcomeEvent.create({ data: { clientId: holder, name: "goal_created", props: { note: NAME } } });
    }
    // Referral attribution: a first-touch row (RESTRICT FK to the client) and the trail of decisions about the same person.
    const refUser = await db.user.upsert({ where: { email: "erasure-partner@example.test" }, update: {}, create: { name: "Erasure Partner", email: "erasure-partner@example.test", passwordHash: "x", role: "PARTNER" } });
    const refPartner = await db.partnerProfile.upsert({ where: { userId: refUser.id }, update: {}, create: { userId: refUser.id, partnerCode: "ZQ-PTR", partnerType: "PARTNER" } });
    await db.partnerReferralTouch.create({ data: { clientId, partnerProfileId: refPartner.id, code: "ZQ-PTR", source: "web", touchedAt: new Date(), expiresAt: new Date(Date.now() + 86400000) } });
    await db.partnerAttributionEvent.create({ data: { clientId, partnerProfileId: refPartner.id, code: "ZQ-PTR", decision: "recorded", source: "web" } });
    // Feature audit entries carry ids and flags only.
    await db.auditLog.create({ data: { userId: admin.id, entity: "Client", entityId: clientId, action: "merged", newValue: { mergedIntoId: survivor.id, appUserIdConflict: true } } });

    const req = await db.erasureRequest.create({ data: { subjectType: "Client", subjectId: clientId, requestedById: admin.id, status: "APPROVED", notes: "Customer asked for erasure" } });
    erasureRequestId = req.id;
  });

  /** Removes everything this test seeds (it runs against a scratch database, but stays re-runnable). */
  async function cleanup() {
    const db = basePrisma;
    const ids = (await db.client.findMany({ where: { clientCode: { in: ["ZQ-0001", "ZQ-SURV", "ZQ-DUP1", "ZQ-DUP2", "ZQ-BYST"] } }, select: { id: true } })).map((c) => c.id);
    await db.$executeRawUnsafe(`DELETE FROM "LeadIntake" WHERE "externalId" LIKE 'app-user-%' AND ("rawPayload"::text ILIKE '%zyxwv%' OR "externalId" IN ('app-user-other-1', '${APP_ID}')) OR "externalId" LIKE 'web-%' AND "rawPayload"::text ILIKE '%zyxwv%' OR "rawPayload"::text LIKE '%"erased": true%'`);
    await db.leadIntake.deleteMany({ where: { OR: [{ clientId: { in: ids } }, { externalId: "web-unlinked-1" }] } });
    await db.cleverTapSync.deleteMany({ where: { clientId: { in: ids } } });
    await db.mergeSuggestion.deleteMany({ where: { OR: [{ clientAId: { in: ids } }, { clientBId: { in: ids } }] } });
    for (const m of ["conversationInsight", "conversationReview", "customerIntelligence", "smartAllvestProfile", "segmentMembership", "interactionOutcome", "assetClassAcceptance", "wealthHealthCheckup", "customerGoal", "customerReview", "suggestionDismissal", "outcomeEvent"] as const) {
      await (db[m] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { clientId: { in: ids } } });
    }
    await db.opportunityStageHistory.deleteMany({ where: { opportunity: { clientId: { in: ids } } } });
    await db.opportunity.deleteMany({ where: { clientId: { in: ids } } });
    await db.activity.deleteMany({ where: { clientId: { in: ids } } });
    await db.message.deleteMany({ where: { clientId: { in: ids } } });
    await db.$executeRawUnsafe(`DELETE FROM "Notification" WHERE "type" = 'lead_reenquiry' AND "userId" = 'erasure-test-admin'`);
    await db.erasureRequest.deleteMany({ where: { requestedById: "erasure-test-admin" } });
    await db.partnerReferralTouch.deleteMany({ where: { clientId: { in: ids } } });
    await db.partnerAttributionEvent.deleteMany({ where: { code: "ZQ-PTR" } });
    await db.client.deleteMany({ where: { id: { in: ids } } });
    await db.partnerProfile.deleteMany({ where: { partnerCode: "ZQ-PTR" } });
    await db.user.deleteMany({ where: { email: "erasure-partner@example.test" } });
  }

  afterAll(async () => {
    if (basePrisma) {
      await cleanup();
      await basePrisma.$disconnect();
    }
  });

  async function dumpAllTables(): Promise<string> {
    const tables = await basePrisma.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name NOT LIKE '\\_prisma%'`,
    );
    const parts: string[] = [];
    for (const { table_name } of tables) {
      const rows = await basePrisma.$queryRawUnsafe<{ j: string }[]>(`SELECT row_to_json(t)::text AS j FROM "${table_name}" t`);
      for (const r of rows) parts.push(`${table_name} ${r.j}`);
    }
    return parts.join("\n");
  }

  it("is clean before erasure (the probes really are in the database)", async () => {
    const dump = await dumpAllTables();
    for (const probe of [NAME, PHONE, EMAIL, APP_ID]) expect(dump).toContain(probe);
  });

  it("scrubs every ledger row, sync row, note and notification, and nothing of anyone else", async () => {
    await executeClientErasureAction(erasureRequestId);

    const dump = (await dumpAllTables()).toLowerCase();
    const leaked = PROBES.filter((probe) => dump.includes(probe.toLowerCase()));
    expect(leaked).toEqual([]);

    // Ledger rows are tombstoned, not deleted: the dedup key is kept as a one-way hash.
    const tombstones = await basePrisma.leadIntake.findMany({ where: { id: { not: otherLedgerId }, rawPayload: { path: ["erased"], equals: true } } });
    expect(tombstones).toHaveLength(3);
    for (const row of tombstones) {
      expect(row.clientId).toBeNull();
      expect(row.error).toBeNull();
      expect(row.externalId).toMatch(/^erased:[0-9a-f]{64}$/);
    }
    // The referral touch goes with the person, and so does the trail of decisions about them.
    expect(await basePrisma.partnerReferralTouch.count({ where: { client: { clientCode: "ZQ-0001" } } })).toBe(0);
    expect(await basePrisma.partnerAttributionEvent.count({ where: { code: "ZQ-PTR" } })).toBe(0);
    // Someone else's data is untouched.
    const other = await basePrisma.leadIntake.findUniqueOrThrow({ where: { id: otherLedgerId } });
    expect(JSON.stringify(other.rawPayload)).toContain(OTHER_NAME);
    expect(other.clientId).toBe(survivorId);
    expect(await basePrisma.notification.count({ where: { payload: { path: ["clientName"], equals: OTHER_NAME } } })).toBe(1);
    const survivorNotes = JSON.stringify((await basePrisma.activity.findMany({ where: { clientId: survivorId } })).map((a) => a.payload));
    expect(survivorNotes).toContain("Someone Else");
    expect(survivorNotes).toContain("ZQ-9999");
  });

  it("scrubs the personal fields of merged-away duplicates that pointed at the erased customer (also a duplicate of a duplicate), and nothing else's", async () => {
    // The dump check above already proved no probe survives anywhere (name, phone in any format, email in any case, both PANs).
    for (const id of [dup1Id, dup2Id]) {
      const row = await basePrisma.client.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ name: "Erased customer", mobile: null, email: null, mobileKey: null, emailKey: null, pan: null, ckycRef: null, city: null, notes: null, marketingConsentText: null });
      expect(row.leadAttribution).toBeNull();
      expect(row.mergedIntoId).not.toBeNull(); // still hidden from every list, and the audit trail still points at a real id
    }
    expect(await basePrisma.conversationReview.count({ where: { clientId: { in: [dup1Id, dup2Id] } } })).toBe(0);
    for (const model of ["customerGoal", "customerReview", "suggestionDismissal", "outcomeEvent"] as const) {
      expect(await (basePrisma[model] as unknown as { count: (a: unknown) => Promise<number> }).count({ where: { clientId: { in: [dup1Id, dup2Id] } } }), model).toBe(0);
    }
    expect(await basePrisma.activity.count({ where: { clientId: { in: [dup1Id, dup2Id] } } })).toBe(0);
    // A duplicate of somebody else is untouched.
    expect(await basePrisma.client.findUniqueOrThrow({ where: { id: bystanderDupId } })).toMatchObject({ name: OTHER_DUP_NAME, mobile: "9000000001" });
  });

  it("a replayed signup of the erased person is acknowledged and does not recreate them", async () => {
    const { ingestLead } = await import("@/lib/leads/ingest");
    const before = await basePrisma.client.count();
    const out = await ingestLead({ source: "allvest_app", externalId: APP_ID, leadSource: "App", name: NAME, phone: PHONE, email: EMAIL }, { userId: APP_ID });
    expect(out.status).toBe("replay");
    expect(await basePrisma.client.count()).toBe(before);
    expect(await basePrisma.leadIntake.count({ where: { externalId: APP_ID } })).toBe(0);
  });
});

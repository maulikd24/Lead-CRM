/**
 * Real-database checks of the dual-write sites (CUSTOMER_EVENTS_ENABLED): the same business scenario runs twice, once with the flag OFF and once ON.
 * OFF: not one event, and the domain footprint (rows added per table) is recorded. ON: exactly the expected facts, threaded by correlation and causation,
 * with no personal identifier in any event, and the domain footprint is IDENTICAL to the flag-off run (the old behaviour is untouched). Re-running a
 * site never stores a fact twice.
 * Skipped unless EVENTS_DB_TEST=1 and DATABASE_URL is a local wt_ scratch database. Run it on its own:
 *   EVENTS_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<wt_w1a_scratch> npx vitest run src/lib/events/dual-write.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn(), requireAccess: vi.fn(), requireUser: vi.fn() }));
vi.mock("@/lib/journeys/dispatch", () => ({ onEvent: vi.fn(async () => {}) }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.EVENTS_DB_TEST === "1" && local && /\/wt_[a-z0-9_]+$/.test(url);

type Footprint = Record<string, number>;

describe.skipIf(!enabled)("dual-write sites (real database)", { timeout: 240_000 }, () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let prisma: typeof import("@/lib/db/prisma").prisma;
  let kit: typeof import("@/lib/relationships/seed-rich-customer.testkit");
  let env: typeof import("./envelope");
  let adminId = "";
  let rmId = "";
  let rm2Id = "";
  const off: { footprint?: Footprint } = {};
  const on: { footprint?: Footprint; clients: Record<string, string> } = { clients: {} };

  const digits = (tag: string) => `9${String(Math.abs([...tag].reduce((a, c) => a * 131 + c.charCodeAt(0), 11)) % 1_000_000_000).padStart(9, "0")}`;
  // AssignmentSettings is a lazily created singleton: the first run on a fresh database creates it, whatever the flag says.
  const EVENT_TABLES = new Set(["CustomerEvent", "EventEmitFailure", "EventDeadLetter", "EventCursor", "DataHealthItem", "AssignmentSettings"]);
  const counts = async (): Promise<Footprint> => Object.fromEntries(Object.entries(await kit.tableCounts(db)).filter(([t]) => !EVENT_TABLES.has(t)));

  /** One scenario touching every dual-written site. Returns the ids it created, keyed by role in the story. */
  async function scenario(tag: string) {
    const created = await import("@/app/(dashboard)/clients/actions");
    const transitions = await import("@/lib/stage-engine/transitions");
    const { ingestLead } = await import("@/lib/leads/ingest");
    const { upsertSupportTicket } = await import("@/lib/support/tickets");
    const { saveExtraction } = await import("@/lib/intelligence/extract");
    const { processWorkerEvent } = await import("@/lib/whatsapp/ingest");
    const { completeOutbox } = await import("@/lib/whatsapp/outbox");
    const { ingestDeviceCalls } = await import("@/lib/device/ingest-calls");
    const { prismaFeedRepo } = await import("@/lib/portfolio-feed/prisma-repo");
    const { prismaReferralStore } = await import("@/lib/referrals/prisma-store");
    const { mergeClientRecords } = await import("@/lib/clients/merge");
    const ids: Record<string, string> = {};

    // A: a lead typed in by hand, with a campaign (explicit RM)
    const made = await created.createClientCore({ name: `Story ${tag}`, mobile: digits(`${tag}-a`), leadSource: "Meta Ads", assignedToId: rmId, leadAttribution: { campaign: `spring-${tag}`, source: "meta_leads" } }, adminId);
    if (made.status !== "created") throw new Error(`createClientCore: ${made.status}`);
    ids.main = made.client.id;

    // B: an ad lead, then the same person again (a duplicate)
    const phone = digits(`${tag}-b`);
    const first = await ingestLead({ source: "meta_leads", externalId: `ext-${tag}-1`, leadSource: "Meta Ads", name: `Lead ${tag}`, phone, attribution: { campaign: `c-${tag}` } }, {});
    const dup = await ingestLead({ source: "meta_leads", externalId: `ext-${tag}-2`, leadSource: "Meta Ads", name: `Lead ${tag}`, phone }, {});
    const dup2 = await ingestLead({ source: "meta_leads", externalId: `ext-${tag}-3`, leadSource: "Meta Ads", name: `Lead ${tag}`, phone }, {});
    if (first.status !== "created" || dup.status !== "duplicate" || dup2.status !== "duplicate") throw new Error(`ingest ${first.status}/${dup.status}/${dup2.status}`);
    ids.lead = first.clientId;

    // C: contact, KYC, funding, lost
    await transitions.recordRmContact(ids.main, { contactMethod: "Phone", contactOutcome: "Connected" }, adminId);
    await transitions.submitForKyc(ids.main, { submissionMethod: "online", override: true }, adminId, "ADMIN");
    await transitions.completeKyc(ids.main, { status: "REJECTED", rejectionReason: "Blurry photo" }, adminId);
    await transitions.updateFunding(ids.lead, { status: "FULLY_FUNDED", amount: 500000, bankAccountVerified: true } as never, adminId);
    await transitions.markNotProceeding(ids.lead, { reason: "Changed mind" }, adminId);

    // D: reassign (manual)
    await created.reassignClientAction(ids.main, rm2Id);

    // E: a ticket, seen twice; a complaint from a conversation
    await upsertSupportTicket(ids.main, "freshdesk", { externalId: `fd-${tag}`, subject: "Cannot log in", status: "open", priority: "high", channel: "email", createdAt: new Date(Date.now() - 3_600_000) }, "webhook");
    await upsertSupportTicket(ids.main, "freshdesk", { externalId: `fd-${tag}`, status: "pending" }, "webhook");
    await saveExtraction({ clientId: ids.main, sourceType: "NOTE", sourceRef: `n-${tag}`, occurredAt: new Date(), extraction: { insights: [{ kind: "COMPLAINT", text: `Unhappy with the delay ${tag}`, severity: "high" }] } as never });

    // F: WhatsApp inbound from an unknown number (creates a lead), then a CRM message confirmed sent, twice
    const waOwner = await db.user.upsert({ where: { email: `dw-wa-${tag.toLowerCase()}@example.test` }, update: {}, create: { email: `dw-wa-${tag.toLowerCase()}@example.test`, name: `WA owner ${tag}`, passwordHash: "x", role: "RM" } });
    const account = await db.whatsAppAccount.upsert({ where: { sessionId: `sess-${tag}` }, update: {}, create: { sessionId: `sess-${tag}`, label: `Line ${tag}`, isActive: true, ownerUserId: waOwner.id } });
    const waPhone = digits(`${tag}-wa`);
    const inbound = { type: "message" as const, sessionId: account.sessionId, externalId: `wa-${tag}-1`, chatId: `91${waPhone}@c.us`, fromMe: false, body: "Hello", messageType: "chat", timestamp: Math.floor(Date.now() / 1000), pushName: `Wa ${tag}` };
    await processWorkerEvent(inbound);
    await processWorkerEvent(inbound); // replay: a duplicate, nothing new
    const waClient = await db.client.findFirstOrThrow({ where: { mobileKey: { endsWith: waPhone.slice(-10) } } });
    ids.wa = waClient.id;
    const queued = await db.message.create({ data: { clientId: waClient.id, accountId: account.id, channel: "whatsapp", provider: "whatsapp_openwa", direction: "OUTBOUND", origin: "crm", senderUserId: rmId, body: `Reply ${tag}`, status: "QUEUED" } });
    await completeOutbox(queued.id, { ok: true, externalId: `wa-out-${tag}` });
    await completeOutbox(queued.id, { ok: true, externalId: `wa-out-${tag}` });

    // G: a phone call log (in the sync's own transaction)
    const device = await db.deviceToken.create({ data: { userId: rmId, tokenHash: `rgdev-${tag}`, label: `Phone ${tag}` } });
    await db.client.update({ where: { id: ids.main }, data: { assignedToId: rmId } });
    const callPhone = (await db.client.findUniqueOrThrow({ where: { id: ids.main } })).mobile!;
    const when = Date.now() - 600_000;
    await ingestDeviceCalls({ id: device.id, userId: rmId }, { id: rmId, role: "RM" }, { calls: [{ number: callPhone, type: "INCOMING", date: when, duration: 75 }] });
    await ingestDeviceCalls({ id: device.id, userId: rmId }, { id: rmId, role: "RM" }, { calls: [{ number: callPhone, type: "INCOMING", date: when, duration: 75 }] });

    // H: the feed: two transactions for the same customer
    const account2 = await prismaFeedRepo.ensureAccount({ accountNumber: `AC-${tag}`, clientId: ids.main });
    const product = await prismaFeedRepo.ensureProduct({ productCode: `P-${tag}`, name: `Fund ${tag}`, category: "MUTUAL_FUND" as never, isin: null });
    const tx = (ref: string, daysAgo: number) => ({ tradingAccountId: account2.id, productId: product.id, transactionType: "BUY" as const, transactionDate: new Date(Date.now() - daysAgo * 86_400_000), settlementDate: null, quantity: "10", price: "100", grossAmount: "1000", netAmount: "1000", brokerageAmount: "1", revision: 1, externalRef: ref });
    await prismaFeedRepo.createTransaction(tx(`T1-${tag}`, 5));
    await prismaFeedRepo.createTransaction(tx(`T2-${tag}`, 2));

    // I: a referral claim (in its own transaction) and a merge
    const referrer = await db.referrer.create({ data: { clientId: ids.lead, createdById: adminId, codes: { create: { code: `RC${tag.toUpperCase()}` } } }, include: { codes: true } });
    const referred = await db.client.create({ data: { clientCode: `RG-${tag}-REF`, name: `Referred ${tag}`, currentStageId: (await db.stage.findFirstOrThrow()).id } });
    ids.referred = referred.id;
    await prismaReferralStore.saveClaim({ key: `claim-${tag}`, referrerId: referrer.id, codeId: referrer.codes[0].id, referredClientId: referred.id, outcome: "ATTRIBUTED", reason: null, attributedAt: new Date() });
    const dupClient = await db.client.create({ data: { clientCode: `RG-${tag}-DUP`, name: `Dup ${tag}`, currentStageId: (await db.stage.findFirstOrThrow()).id } });
    ids.dup = dupClient.id;
    await prisma.$transaction((t) => mergeClientRecords(t, ids.referred, dupClient.id, adminId));
    return ids;
  }

  /** Removes every customer this suite creates (found by name or code), using the registry's own erase order, then the rows around them. */
  async function cleanupScenario() {
    const { registryDeleteChildren } = await import("@/lib/relationships/erase");
    const ids = (await db.client.findMany({ where: { OR: [{ name: { startsWith: "Story " } }, { name: { startsWith: "Lead " } }, { name: { startsWith: "Wa " } }, { clientCode: { startsWith: "RG-" } }] }, select: { id: true } })).map((c) => c.id);
    if (ids.length) {
      const accounts = (await db.tradingAccount.findMany({ where: { clientId: { in: ids } }, select: { id: true } })).map((a) => a.id);
      await db.transaction.deleteMany({ where: { tradingAccountId: { in: accounts } } });
      await db.position.deleteMany({ where: { tradingAccountId: { in: accounts } } });
      await db.productEntitlement.deleteMany({ where: { tradingAccountId: { in: accounts } } });
      await db.tradingAccount.deleteMany({ where: { id: { in: accounts } } });
      await db.pmsAifHolding.deleteMany({ where: { clientId: { in: ids } } });
      await db.$transaction(async (t) => {
        await registryDeleteChildren(t as never, ids);
        await t.leadIntake.deleteMany({ where: { OR: [{ clientId: { in: ids } }, { externalId: { startsWith: "ext-" } }, { externalId: { startsWith: "wa-" } }] } });
        for (const id of ids) await t.notification.deleteMany({ where: { payload: { path: ["clientId"], equals: id } } });
        await t.client.deleteMany({ where: { id: { in: ids } } });
      });
    }
    await db.product.deleteMany({ where: { productCode: { startsWith: "P-" } } });
    await db.deviceToken.deleteMany({ where: { tokenHash: { startsWith: "rgdev-" } } });
    await db.whatsAppAccount.deleteMany({ where: { sessionId: { startsWith: "sess-" } } });
    await db.user.deleteMany({ where: { email: { startsWith: "dw-wa-" } } }).catch(() => {});
    await db.partnerProfile.deleteMany({ where: { partnerCode: { startsWith: "RG-" } } });
    await db.customerEvent.deleteMany({});
    await db.eventEmitFailure.deleteMany({});
    await db.journeyRun.deleteMany({ where: { clientId: { in: ids } } });
  }
  beforeAll(async () => {
    ({ basePrisma: db, prisma } = await import("@/lib/db/prisma"));
    kit = await import("@/lib/relationships/seed-rich-customer.testkit");
    env = await import("./envelope");
    const base = await kit.ensureStageAndAdmin(db, "dw-admin");
    adminId = base.adminId;
    rmId = (await db.user.upsert({ where: { email: "dw-rm@example.test" }, update: {}, create: { email: "dw-rm@example.test", name: "DW RM", passwordHash: "x", role: "RM" } })).id;
    rm2Id = (await db.user.upsert({ where: { email: "dw-rm2@example.test" }, update: {}, create: { email: "dw-rm2@example.test", name: "DW RM Two", passwordHash: "x", role: "RM" } })).id;
    const rr = await import("@/lib/auth/require-role");
    (rr.requireAccess as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ user: { id: adminId, role: "ADMIN" } });
    await db.stage.upsert({ where: { name: "New Lead" }, update: {}, create: { name: "New Lead", sequence: 1, slaHours: 24 } }).catch(() => {});
    await (await import("@/lib/system/system-actor")).seedSystemActor(); // inbound leads and WhatsApp contacts are created by the system actor
    await cleanupScenario();
  });
  afterAll(async () => {
    await cleanupScenario().catch((e) => console.error("cleanup", (e as Error).message));
    await kit.cleanupRichCustomers(db).catch(() => {});
    delete process.env.CUSTOMER_EVENTS_ENABLED;
  });

  it("flag OFF: not one event, not one failure record, and the domain footprint is recorded", async () => {
    delete process.env.CUSTOMER_EVENTS_ENABLED;
    const before = await counts();
    await scenario("OFFA");
    off.footprint = kit.deltas(before, await counts());
    expect(await db.customerEvent.count()).toBe(0);
    expect(await db.eventEmitFailure.count()).toBe(0);
    expect(Object.keys(off.footprint).length).toBeGreaterThan(15);
  });

  it("flag ON: the same scenario leaves the same domain footprint (the old behaviour is untouched)", async () => {
    process.env.CUSTOMER_EVENTS_ENABLED = "1";
    const before = await counts();
    on.clients = await scenario("ONAA");
    on.footprint = kit.deltas(before, await counts());
    expect(on.footprint).toEqual(off.footprint);
    expect(await db.eventEmitFailure.count()).toBe(0);
  });

  it("flag ON: the expected facts, once each, for the customer they are about", async () => {
    const evs = async (clientId: string) => (await db.customerEvent.findMany({ where: { clientId }, orderBy: { seq: "asc" } })).map((e) => e.eventType);
    const main = await evs(on.clients.main);
    expect(main).toEqual(expect.arrayContaining(["lead.created", "lead.assigned", "campaign.lead.attributed", "lead.contacted", "account.kyc.started", "account.kyc.rejected", "customer.stage.changed", "ticket.created", "complaint.raised", "call.logged", "transaction.recorded"]));
    for (const unique of ["lead.created", "campaign.lead.attributed", "lead.contacted", "account.kyc.started", "account.kyc.rejected", "ticket.created", "complaint.raised", "call.logged"]) expect(main.filter((t) => t === unique), unique).toHaveLength(1); // a ticket seen twice, a call synced twice: one fact
    expect(main.filter((t) => t === "lead.assigned")).toHaveLength(2); // the first assignment and the manual reassignment
    expect(main.filter((t) => t === "transaction.recorded")).toHaveLength(2);
    const tx = await db.customerEvent.findMany({ where: { clientId: on.clients.main, eventType: "transaction.recorded" }, orderBy: { occurredAt: "asc" } });
    expect(tx.map((e) => (e.metadata as { first: boolean }).first)).toEqual([true, false]);
    const lead = await evs(on.clients.lead);
    expect(lead).toEqual(expect.arrayContaining(["lead.created", "lead.assigned", "campaign.lead.attributed", "lead.deduplicated", "account.funded", "lead.lost"]));
    expect(lead.filter((t) => t === "lead.deduplicated")).toHaveLength(2); // two further enquiries by the same person: two facts, one per ledger row
    const wa = await evs(on.clients.wa);
    expect(wa.filter((t) => t === "whatsapp.message.received")).toHaveLength(1); // the replay was a duplicate
    expect(wa.filter((t) => t === "whatsapp.message.sent")).toHaveLength(1); // confirmed twice, one fact
    expect(await evs(on.clients.referred)).toEqual(expect.arrayContaining(["referral.attributed", "customer.merged"]));
  });

  it("threading: one correlation id per customer, assigned and contacted caused by created, every event valid and classified", async () => {
    const rows = await db.customerEvent.findMany({ where: { clientId: on.clients.main } });
    for (const r of rows) {
      expect(r.correlationId, r.eventType).toBe(env.flowCorrelationId(on.clients.main));
      expect(r.eventId).toBe(env.eventIdFor(r.source, r.dedupeKey));
      expect(r.schemaVersion).toBe(1);
    }
    const created = rows.find((r) => r.eventType === "lead.created")!;
    for (const t of ["lead.assigned", "lead.contacted"]) expect(rows.find((r) => r.eventType === t)!.causationId, t).toBe(created.eventId);
    expect(rows.every((r) => r.receivedAt >= new Date(r.occurredAt.getTime() - 5 * 60_000))).toBe(true);
  });

  it("no event carries a name, phone, email or free text", async () => {
    const dump = JSON.stringify(await db.customerEvent.findMany(), (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    for (const probe of ["Story ONAA", "Lead ONAA", "Cannot log in", "Unhappy with the delay", "Hello", "Reply ONAA", "Blurry photo", "@example", digits("ONAA-a"), digits("ONAA-b"), digits("ONAA-wa")]) expect(dump.includes(probe), probe).toBe(false);
  });

  it("the call fact commits with the call row: a rolled back sync leaves neither", async () => {
    process.env.CUSTOMER_EVENTS_ENABLED = "1";
    const { emitCallLoggedInTx } = await import("./producers-emit");
    const before = await db.customerEvent.count({ where: { eventType: "call.logged" } });
    await expect(prisma.$transaction(async (t) => {
      await emitCallLoggedInTx(t, { clientId: on.clients.main, callId: "rolled-back-call", direction: "OUTGOING", durationSeconds: 5, startedAt: new Date(), userId: rmId });
      throw new Error("sync failed after the event");
    })).rejects.toThrow("sync failed");
    expect(await db.customerEvent.count({ where: { eventType: "call.logged" } })).toBe(before);
  });

  it("a blocked merge stores no merge fact", async () => {
    const { mergeClientRecords } = await import("@/lib/clients/merge");
    const before = await db.customerEvent.count({ where: { eventType: "customer.merged" } });
    await expect(prisma.$transaction((t) => mergeClientRecords(t, on.clients.main, on.clients.main, adminId))).rejects.toThrow();
    expect(await db.customerEvent.count({ where: { eventType: "customer.merged" } })).toBe(before);
  });
});

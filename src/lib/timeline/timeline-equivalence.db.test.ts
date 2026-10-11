/**
 * Equivalence of the canonical timeline reader with the Customer 360 timeline it will replace, on a real database: for every seeded customer (and a rich
 * synthetic one with stage changes, tickets, completed tasks, consent changes, complaints, commitments, KYC and funding milestones and facts), every item
 * the old timeline showed must appear in the new one, or be explicitly replaced by an item that says so (`supersedes`). Everything the new reader adds comes
 * from a source the old one never read. Also: role scoping (Marketing never, an RM only their own customers), cursor pagination, source refs that point at
 * real rows, and an as-of time on every item.
 * Skipped unless TIMELINE_DB_TEST=1 and DATABASE_URL is a local wt_ scratch database (seed it first with seed-e2e and layout-budget:seed for the broad part).
 *   TIMELINE_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<wt_w1a_seeded> npx vitest run src/lib/timeline/timeline-equivalence.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("react", async () => ({ ...(await vi.importActual<typeof import("react")>("react")), cache: <T,>(fn: T) => fn }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.TIMELINE_DB_TEST === "1" && local && /\/wt_[a-z0-9_]+$/.test(url);

/** Sources the old Customer 360 timeline never read. The new reader may add items from these and only these. */
const NEW_SOURCES = new Set(["task", "ticket", "consent", "stage", "insight", "milestone", "goal", "referral", "event"]);

describe.skipIf(!enabled)("the canonical timeline equals the Customer 360 timeline (real database)", { timeout: 300_000 }, () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let legacy: typeof import("@/lib/c360/loaders");
  let reader: typeof import("./reader");
  let kit: typeof import("@/lib/relationships/seed-rich-customer.testkit");
  let registry: typeof import("@/lib/relationships/registry");
  let admin: { id: string; role: "ADMIN" };
  let manager: { id: string; role: "MANAGER" };
  let rm: { id: string; role: "RM" };
  let rm2: { id: string; role: "RM" };
  let marketing: { id: string; role: "MARKETING" };
  let richId = "";
  let richRmId = "";

  const get = async (id: string, viewer: { id: string; role: string }, extra: Record<string, unknown> = {}) => reader.getCustomerTimeline(id, { viewer: viewer as never, limit: 200, includeEvents: true, ...extra });

  beforeAll(async () => {
    ({ basePrisma: db } = await import("@/lib/db/prisma"));
    legacy = await import("@/lib/c360/loaders");
    reader = await import("./reader");
    kit = await import("@/lib/relationships/seed-rich-customer.testkit");
    registry = await import("@/lib/relationships/registry");
    const user = async (email: string, role: "ADMIN" | "MANAGER" | "RM" | "MARKETING") => db.user.upsert({ where: { email }, update: {}, create: { email, name: email.split("@")[0], passwordHash: "x", role } });
    admin = { id: (await user("admin@supportify.local", "ADMIN")).id, role: "ADMIN" };
    manager = { id: (await user("manager@supportify.local", "MANAGER")).id, role: "MANAGER" };
    rm = { id: (await user("rm@supportify.local", "RM")).id, role: "RM" };
    rm2 = { id: (await user("rm2-tl@example.test", "RM")).id, role: "RM" };
    marketing = { id: (await user("marketing-tl@example.test", "MARKETING")).id, role: "MARKETING" };
    await kit.cleanupRichCustomers(db);

    // A rich customer assigned to `rm`, with a row in every new source and mirrored legacy rows.
    const base = await kit.ensureStageAndAdmin(db, "rg-timeline-admin");
    const c = await kit.seedRichCustomer(db, "TLNA", { stageId: base.stageId, adminId: base.adminId });
    richId = c.clientId;
    const second = await db.stage.create({ data: { name: `Timeline stage ${Date.now()}`, sequence: 9300 + Math.floor(Math.random() * 500), slaHours: 24 } });
    await db.client.update({ where: { id: richId }, data: { assignedToId: rm.id } });
    richRmId = rm.id;
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
    await db.stageHistory.create({ data: { clientId: richId, fromStageId: base.stageId, toStageId: second.id, changedById: base.adminId, changedAt: at(50), slaMet: false } });
    await db.activity.create({ data: { clientId: richId, type: "STAGE_CHANGE", payload: { message: "Stage changed", fromStage: (await db.stage.findFirstOrThrow({ where: { id: base.stageId } })).name, toStage: second.name }, createdAt: at(50) } });
    const ticket = await db.activity.create({ data: { clientId: richId, type: "TICKET", payload: { message: "Ticket opened", status: "open" }, createdAt: at(40) } });
    await db.supportTicket.updateMany({ where: { clientId: richId }, data: { activityId: ticket.id, ticketCreatedAt: at(40), status: "open" } });
    const task = await db.task.create({ data: { clientId: richId, assignedToId: base.adminId, title: "Send the form", dueAt: at(-60), status: "DONE" } });
    await db.activity.create({ data: { clientId: richId, type: "TASK_COMPLETED", payload: { message: `Completed task: ${task.title}` }, createdAt: new Date(task.updatedAt.getTime() + 1000) } });
    await db.task.create({ data: { clientId: richId, assignedToId: base.adminId, title: "Open follow up", dueAt: at(-120) } });
    await db.message.create({ data: { clientId: richId, channel: "WHATSAPP", provider: "x", direction: "OUTBOUND", body: "Mirrored body", createdAt: at(30) } });
    await db.activity.create({ data: { clientId: richId, type: "MESSAGE", payload: { channel: "whatsapp", direction: "OUTBOUND", body: "Mirrored body" }, createdAt: at(30) } });
    await db.consentRecord.create({ data: { clientId: richId, purpose: "MARKETING_COMMS", channel: "WHATSAPP", status: "WITHDRAWN", source: "crm", capturedAt: at(20) } });
    await db.conversationInsight.create({ data: { clientId: richId, kind: "COMPLAINT", text: "Unhappy with the delay", severity: "high", sourceType: "NOTE", sourceRef: "n1", dedupeKey: "tl-complaint", occurredAt: at(15) } });
    await db.conversationInsight.create({ data: { clientId: richId, kind: "COMMITMENT", text: "Send factsheet", dueAt: at(-2000), sourceType: "NOTE", sourceRef: "n2", dedupeKey: "tl-commit", occurredAt: at(14) } });
    await db.kycRecord.update({ where: { clientId: richId }, data: { status: "APPROVED", submissionDate: at(100), completionDate: at(90) } });
    await db.fundingRecord.update({ where: { clientId: richId }, data: { status: "FULLY_FUNDED", fundingDate: at(80) } });
    await db.customerEvent.createMany({ data: [
      { eventId: "11111111-1111-4111-8111-aaaaaaaaaaa1", eventType: "lead.assigned", occurredAt: at(55), actorType: "user", clientId: richId, source: "crm.web", correlationId: "c", schemaVersion: 1, dataClass: "PERSONAL", dedupeKey: "tl-assigned", metadata: { ref: { table: "Client", id: richId } } },
      { eventId: "11111111-1111-4111-8111-aaaaaaaaaaa2", eventType: "whatsapp.message.sent", occurredAt: at(30), actorType: "user", clientId: richId, source: "crm.web", correlationId: "c", schemaVersion: 1, dataClass: "PERSONAL", dedupeKey: "tl-msg", metadata: { ref: { table: "Message", id: (await db.message.findFirstOrThrow({ where: { clientId: richId, body: "Mirrored body" } })).id } } },
      { eventId: "11111111-1111-4111-8111-aaaaaaaaaaa3", eventType: "whatsapp.message.read", occurredAt: at(29), actorType: "system", clientId: richId, source: "crm.web", correlationId: "c", schemaVersion: 1, dataClass: "INTERNAL", dedupeKey: "tl-read", metadata: {} },
    ] });
  });
  afterAll(async () => { await kit.cleanupRichCustomers(db); await db.stage.deleteMany({ where: { name: { startsWith: "Timeline stage" } } }).catch(() => {}); await db.user.deleteMany({ where: { email: { in: ["rm2-tl@example.test", "marketing-tl@example.test"] } } }).catch(() => {}); });

  it("every seeded customer: nothing the old timeline showed has gone missing, and what is new comes only from new sources", async () => {
    const ids = (await db.client.findMany({ where: { mergedIntoId: null, isDeleted: false }, select: { id: true }, orderBy: { createdAt: "asc" }, take: 400 })).map((c) => c.id);
    expect(ids.length).toBeGreaterThan(10);
    let legacyTotal = 0;
    let newOnly = 0;
    const problems: string[] = [];
    for (const id of ids) {
      const old = await legacy.loadTimeline(id);
      const res = await get(id, admin);
      if (!res.ok) { problems.push(`${id}: ${res.reason}`); continue; }
      const nowIds = new Set(res.items.map((i) => i.id));
      const absorbed = new Set(res.items.flatMap((i) => i.supersedes ?? []));
      for (const e of old.events) {
        legacyTotal += 1;
        if (!nowIds.has(e.id) && !absorbed.has(e.id)) problems.push(`${id}: legacy item ${e.id} (${e.title}) is neither shown nor superseded`);
      }
      const legacyIds = new Set(old.events.map((e) => e.id));
      for (const i of res.items) if (!legacyIds.has(i.id)) { newOnly += 1; if (!NEW_SOURCES.has(i.source)) problems.push(`${id}: ${i.id} comes from ${i.source}, a source the old timeline already read`); }
      // ordering, uniqueness, refs, as-of
      expect(res.items.map((i) => i.id).length).toBe(nowIds.size);
      for (let k = 1; k < res.items.length; k++) expect(Date.parse(res.items[k - 1].at) >= Date.parse(res.items[k].at)).toBe(true);
      for (const i of res.items) { expect(Number.isNaN(Date.parse(i.asOf))).toBe(false); if (i.source !== "event") expect(i.sourceRef, i.id).not.toBeNull(); }
    }
    expect(problems).toEqual([]);
    expect(legacyTotal).toBeGreaterThan(20); // the seeds really exercised the comparison
    console.log(`timeline equivalence: ${ids.length} customers, ${legacyTotal} legacy items all present or superseded, ${newOnly} items added from new sources`);
  });

  it("the rich customer: replaced presentations are absorbed once, every new source shows, deliveries are noise", async () => {
    const old = await legacy.loadTimeline(richId);
    const res = await get(richId, admin);
    if (!res.ok) throw new Error(res.reason);
    const ids = res.items.map((i) => i.id);
    const bySource = (s: string) => res.items.filter((i) => i.source === s);
    expect(bySource("stage")).toHaveLength(2); // the seeded move into the first stage, and the one this test adds
    expect(old.events.filter((e) => e.kind === "stage")).toHaveLength(1); // the legacy STAGE_CHANGE activity...
    expect(ids.some((id) => id.startsWith("activity:") && res.items.find((i) => i.id === id)?.kind === "stage")).toBe(false); // ...is shown once, as the stage row
    expect(bySource("stage").flatMap((i) => i.supersedes ?? [])).toEqual(old.events.filter((e) => e.kind === "stage").map((e) => e.id));
    expect(bySource("ticket")).toHaveLength(1);
    expect(bySource("ticket")[0].supersedes?.length).toBe(1);
    expect(bySource("task").map((i) => i.title).sort()).toEqual(["Task: Call ZqprobeTLNA SurnameTLNA", "Task: Open follow up"]); // the done task is shown by its completed activity, not twice
    expect(res.items.filter((i) => i.title === "Task completed: Send the form")).toEqual([]);
    expect(res.items.some((i) => i.kind === "task" && i.id.startsWith("activity:"))).toBe(true);
    expect(bySource("consent").map((i) => i.title).sort()).toEqual(["Consent granted: service comms (WhatsApp)", "Consent withdrawn: marketing comms (WhatsApp)"]);
    expect(bySource("insight").map((i) => i.kind).sort()).toEqual(["commitment", "complaint"]);
    expect(bySource("milestone").map((i) => i.title).sort()).toEqual(["Account funded", "KYC approved", "KYC submitted"]);
    // the message is shown once (the Message row); its mirrored activity and the fact about it are not repeated; delivery receipts are not shown
    expect(res.items.filter((i) => i.title.includes("sent") && i.channel === "whatsapp")).toHaveLength(1);
    expect(bySource("event").map((i) => i.title).sort()).toEqual(["Lead assigned", "Lead created"]); // the sent-message fact is covered by its Message row; the read receipt is noise
    expect(res.items.filter((i) => i.detail === "Mirrored body")).toHaveLength(1);
  });

  it("role scoping: Marketing never, an RM only their own customers, a manager and an admin yes; nothing leaks through the answer", async () => {
    expect(await get(richId, marketing)).toEqual({ ok: false, reason: "forbidden" });
    for (const role of ["FINANCE", "PARTNER", "DEALER"]) expect(await get(richId, { id: "x", role })).toEqual({ ok: false, reason: "forbidden" });
    expect((await get(richId, rm)).ok).toBe(true);
    expect(await get(richId, rm2)).toEqual({ ok: false, reason: "not_found" });
    expect((await get(richId, manager)).ok).toBe(true);
    expect((await get(richId, admin)).ok).toBe(true);
    expect(await get("does-not-exist", admin)).toEqual({ ok: false, reason: "not_found" });
    void richRmId;
  });

  it("a merged customer is not found for anyone, an archived one only for an Admin", async () => {
    const merged = await db.client.create({ data: { clientCode: "RG-TLMRG", name: "Merged", currentStageId: (await db.stage.findFirstOrThrow()).id, mergedIntoId: richId } });
    expect(await get(merged.id, admin)).toEqual({ ok: false, reason: "not_found" });
    await db.client.update({ where: { id: merged.id }, data: { mergedIntoId: null, isDeleted: true, deletedAt: new Date() } });
    expect(await get(merged.id, manager)).toEqual({ ok: false, reason: "not_found" });
    expect((await get(merged.id, admin)).ok).toBe(true);
  });

  it("cursor pagination returns exactly the items of one big page, with no gap and no repeat", async () => {
    const big = await get(richId, admin);
    if (!big.ok) throw new Error("big");
    const collected: string[] = [];
    let before: string | null = null;
    for (let guard = 0; guard < 50; guard++) {
      const page = await reader.getCustomerTimeline(richId, { viewer: admin, limit: 5, before, includeEvents: true });
      if (!page.ok) throw new Error(page.reason);
      collected.push(...page.items.map((i) => i.id));
      before = page.nextCursor;
      if (!before) break;
    }
    expect(collected).toEqual(big.items.map((i) => i.id));
  });

  it("source refs point at real rows", async () => {
    const res = await get(richId, admin);
    if (!res.ok) throw new Error("x");
    const delegates = db as unknown as Record<string, { count: (a: unknown) => Promise<number> }>;
    for (const i of res.items) {
      if (!i.sourceRef) continue;
      expect(await delegates[registry.delegateOf(i.sourceRef.table)].count({ where: { id: i.sourceRef.id } }), `${i.id} -> ${i.sourceRef.table}`).toBe(1);
    }
  });

  it("with events off no CustomerEvent item appears, and freshness names every source", async () => {
    const res = await get(richId, admin, { includeEvents: false });
    if (!res.ok) throw new Error("x");
    expect(res.items.some((i) => i.source === "event")).toBe(false);
    expect(Object.keys(res.freshness.sources)).toEqual(expect.arrayContaining(["activity", "message", "task", "ticket", "consent", "stage", "insight", "milestone"]));
    expect(res.freshness.sources.event).toBeUndefined();
  });
});

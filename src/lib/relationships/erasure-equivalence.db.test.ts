/**
 * Equivalence of the registry-driven erasure with the original: two identical synthetic customers are seeded in one database (a row in every table an
 * erasure deletes, plus merged duplicates, ledger rows, notifications and event rows); one is erased with the ORIGINAL steps, the other from the REGISTRY.
 * The per-table row-count change must be identical, no probe may survive in any table, and every blocking trail must refuse with the same message and
 * change nothing. Skipped unless RELATIONSHIPS_DB_TEST=1 and DATABASE_URL is a local wt_ scratch database. Run it on its own:
 *   RELATIONSHIPS_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<wt_w1a_scratch> npx vitest run src/lib/relationships/erasure-equivalence.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn(async () => ({ user: { id: "rg-erasure-admin", role: "ADMIN" } })) }));
vi.mock("@/lib/policy/approvals/service", () => ({ requestApproval: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.RELATIONSHIPS_DB_TEST === "1" && local && /\/wt_[a-z0-9_]+$/.test(url);

describe.skipIf(!enabled)("registry-driven erasure equals the original (real database)", { timeout: 120_000 }, () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let kit: typeof import("./seed-rich-customer.testkit");
  let registry: typeof import("./registry");
  let act: typeof import("@/app/(dashboard)/settings/data-privacy/actions");
  let stageId = "";
  let adminId = "";
  const toClean: string[] = [];

  async function approvedRequest(clientId: string) {
    return (await db.erasureRequest.create({ data: { subjectType: "Client", subjectId: clientId, requestedById: adminId, status: "APPROVED", notes: "Customer asked" } })).id;
  }
  async function erase(clientId: string, useRegistry: boolean) {
    if (useRegistry) process.env.RELATIONSHIP_REGISTRY_ERASURE = "1"; else delete process.env.RELATIONSHIP_REGISTRY_ERASURE;
    try { await act.executeClientErasureAction(await approvedRequest(clientId)); } finally { delete process.env.RELATIONSHIP_REGISTRY_ERASURE; }
  }

  beforeAll(async () => {
    ({ basePrisma: db } = await import("@/lib/db/prisma"));
    kit = await import("./seed-rich-customer.testkit");
    registry = await import("./registry");
    act = await import("@/app/(dashboard)/settings/data-privacy/actions");
    const base = await kit.ensureStageAndAdmin(db, "rg-erasure-admin");
    stageId = base.stageId;
    adminId = (await db.user.upsert({ where: { id: "rg-erasure-admin" }, update: {}, create: { id: "rg-erasure-admin", name: "Registry Erasure Admin", email: "rg-erasure-admin2@example.test", passwordHash: "x", role: "ADMIN" } })).id;
    await kit.cleanupRichCustomers(db);
  });
  afterAll(async () => {
    await kit.cleanupRichCustomers(db);
    await db.erasureRequest.deleteMany({ where: { requestedById: adminId } });
    void toClean;
  });

  it("the seeded customer has a row in every table the registry erases (so the comparison exercises the whole registry)", async () => {
    const c = await kit.seedRichCustomer(db, "COVR", { stageId, adminId });
    const missing: string[] = [];
    for (const r of registry.RELATIONSHIPS) {
      if (!["delete", "block_then_delete"].includes(r.erase.kind) && !(r.erase.kind === "tombstone") && !(r.erase.kind === "handler")) continue;
      const d = (db as unknown as Record<string, { count: (a: unknown) => Promise<number> }>)[registry.delegateOf(r.model)];
      if ((await d.count({ where: registry.whereForClients([...r.paths, ...(r.extraErasePaths ?? [])], [c.clientId]) })) === 0) missing.push(r.model);
    }
    expect(missing).toEqual([]);
    await erase(c.clientId, true); // leave nothing behind
  });

  it("the same per-table change, no probe left anywhere, for the original steps and for the registry", async () => {
    const a = await kit.seedRichCustomer(db, "AAAA", { stageId, adminId });
    const dupA = await kit.seedRichCustomer(db, "AAAD", { stageId, adminId, mergedInto: a.clientId });
    const b = await kit.seedRichCustomer(db, "BBBB", { stageId, adminId });
    const dupB = await kit.seedRichCustomer(db, "BBBD", { stageId, adminId, mergedInto: b.clientId });

    const before = await kit.tableCounts(db);
    await erase(a.clientId, false);
    const afterA = await kit.tableCounts(db);
    await erase(b.clientId, true);
    const afterB = await kit.tableCounts(db);

    const changeA = kit.deltas(before, afterA);
    const changeB = kit.deltas(afterA, afterB);
    expect(changeB).toEqual(changeA);
    expect(Object.keys(changeA).length).toBeGreaterThan(30); // a real erasure, not a no-op

    const dump = (await kit.dumpAllTables(db)).toLowerCase();
    for (const probe of [...a.probes, ...b.probes, ...dupA.probes, ...dupB.probes]) expect(dump.includes(probe.toLowerCase()), probe).toBe(false);

    // The facts about the erased customers stay (id, type, times), with their data nulled; the erasure itself is recorded when events are on.
    for (const c of [a, b]) {
      const events = await db.customerEvent.findMany({ where: { clientId: c.clientId } });
      expect(events.length).toBeGreaterThan(0);
      for (const e of events) {
        expect(e.metadata).toBeNull();
        expect(e.consentContext).toBeNull();
        expect(e.dedupeKey).toMatch(/^erased:[0-9a-f]{32}$/);
        expect(e.eventType).toBe("lead.created");
      }
      expect(await db.client.count({ where: { id: c.clientId } })).toBe(0);
    }
  });

  it.each([
    ["TradingAccount", async (id: string) => { await db.tradingAccount.create({ data: { clientId: id, accountType: "EQUITY", accountNumber: `acc-${id}` } }); }, "Trading Accounts"],
    ["HouseholdMember", async (id: string) => { const h = await db.household.create({ data: { name: "H", householdCode: `RGHH-${id}` } }); await db.householdMember.create({ data: { householdId: h.id, clientId: id } }); }, "Household"],
    ["RevenueEvent", async (id: string) => { await db.revenueEvent.create({ data: { clientId: id, sourceSystem: "t", externalRef: `r-${id}`, revenueType: "BROKERAGE", grossRevenueAmount: 1, eventDate: new Date(), rawPayload: {} } }); }, "Revenue Events"],
    ["ClientPayment", async (id: string) => { await db.clientPayment.create({ data: { clientId: id, amount: 10, paidAt: new Date(), sourceSystem: "t", externalRef: `p-${id}` } }); }, "Payments"],
    ["AdvisoryInteraction", async (id: string) => { await db.advisoryInteraction.create({ data: { clientId: id, advisorId: adminId, type: "OTHER" } }); }, "Advisory Interactions"],
    ["PmsAifHolding", async (id: string) => { await db.pmsAifHolding.create({ data: { clientId: id, productName: "Invested", status: "INVESTED" } }); }, "PMS/AIF holdings"],
  ])("a %s trail blocks the erasure with the same message in both paths and changes nothing", async (_name, add, fragment) => {
    const tag = `BLK${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const c = await db.client.create({ data: { clientCode: `RG-${tag}`, name: `Blocked ${tag}`, currentStageId: stageId } });
    try { await add(c.id); } catch (e) { throw new Error(`could not seed the blocker: ${(e as Error).message}`); }
    const before = await kit.tableCounts(db);
    const messages: string[] = [];
    for (const useRegistry of [false, true]) {
      try { await erase(c.id, useRegistry); messages.push("NO ERROR"); } catch (e) { messages.push((e as Error).message); }
    }
    expect(messages[0]).toContain(fragment);
    expect(messages[1]).toBe(messages[0]);
    const after = await kit.tableCounts(db);
    expect(kit.deltas(before, after)).toEqual({ ErasureRequest: 2 }); // only the two requests the test made; nothing was erased
    expect(await db.client.count({ where: { id: c.id } })).toBe(1);
  });
});

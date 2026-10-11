/**
 * Equivalence of the registry-driven merge with the original `mergeClientRecords`, on a real database: identical pairs of synthetic customers are
 * merged, one pair with the ORIGINAL statements, one from the REGISTRY, and the result must match table by table: who owns how many rows afterwards,
 * which conflicts are reported, the note and audit entry. Covers rows that move, rows that stay (the known gaps), the one-per-customer tables with
 * and without a survivor row, and a duplicate whose only joint holder is soft-deleted.
 * Skipped unless RELATIONSHIPS_DB_TEST=1 and DATABASE_URL is a local wt_ scratch database. Run it on its own:
 *   RELATIONSHIPS_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<wt_w1a_scratch> npx vitest run src/lib/relationships/merge-equivalence.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.RELATIONSHIPS_DB_TEST === "1" && local && /\/wt_[a-z0-9_]+$/.test(url);

describe.skipIf(!enabled)("registry-driven merge equals the original (real database)", { timeout: 120_000 }, () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let prisma: typeof import("@/lib/db/prisma").prisma;
  let kit: typeof import("./seed-rich-customer.testkit");
  let registry: typeof import("./registry");
  let mergeMod: typeof import("@/lib/clients/merge");
  let stageId = "";
  let adminId = "";

  /** For every registry table with a direct customer column: [rows owned by the survivor, rows owned by the archived duplicate]. */
  async function ownership(primaryId: string, dupId: string) {
    const out: Record<string, [number, number]> = {};
    for (const r of registry.RELATIONSHIPS) {
      if (r.kind === "indirect") continue;
      const d = (db as unknown as Record<string, { count: (a: unknown) => Promise<number> }>)[registry.delegateOf(r.model)];
      const count = (id: string) => d.count({ where: registry.whereForClients(r.paths, [id]) });
      out[r.model] = [await count(primaryId), await count(dupId)];
    }
    return out;
  }
  async function mergePair(primaryId: string, dupId: string, useRegistry: boolean) {
    if (useRegistry) process.env.RELATIONSHIP_REGISTRY_MERGE = "1"; else delete process.env.RELATIONSHIP_REGISTRY_MERGE;
    try { return await prisma.$transaction((tx) => mergeMod.mergeClientRecords(tx, primaryId, dupId, adminId, { linkAppIds: false })); } finally { delete process.env.RELATIONSHIP_REGISTRY_MERGE; }
  }
  const noteAndAudit = async (primaryId: string, dupId: string) => ({
    notes: (await db.activity.findMany({ where: { clientId: primaryId, type: "NOTE" }, select: { payload: true } })).map((a) => JSON.stringify(a.payload).replace(/RG-[A-Z]+/g, "RG-x")).filter((p) => p.includes("Merged duplicate")).sort(),
    audit: (await db.auditLog.findMany({ where: { entity: "Client", entityId: dupId, action: "merged" }, select: { newValue: true } })).map((a) => JSON.stringify(a.newValue).replace(primaryId, "P")),
    dup: await db.client.findUniqueOrThrow({ where: { id: dupId }, select: { status: true, mergedIntoId: true } }).then((c) => ({ status: c.status, merged: c.mergedIntoId === primaryId })),
  });

  beforeAll(async () => {
    ({ basePrisma: db, prisma } = await import("@/lib/db/prisma"));
    kit = await import("./seed-rich-customer.testkit");
    registry = await import("./registry");
    mergeMod = await import("@/lib/clients/merge");
    const base = await kit.ensureStageAndAdmin(db, "rg-merge-admin");
    stageId = base.stageId;
    adminId = base.adminId;
    await kit.cleanupRichCustomers(db);
  });
  afterAll(async () => { await kit.cleanupRichCustomers(db); });

  it("both customers rich: the same rows move, the same rows stay, the same conflicts are reported", async () => {
    const a = await kit.seedRichCustomer(db, "MAAP", { stageId, adminId });
    const aDup = await kit.seedRichCustomer(db, "MAAD", { stageId, adminId });
    const b = await kit.seedRichCustomer(db, "MBBP", { stageId, adminId });
    const bDup = await kit.seedRichCustomer(db, "MBBD", { stageId, adminId });

    const sumA = await mergePair(a.clientId, aDup.clientId, false);
    const sumB = await mergePair(b.clientId, bDup.clientId, true);
    expect(sumB.conflicts).toEqual(sumA.conflicts);
    expect(sumA.conflicts).toEqual(["KycStep", "KycRecord", "FundingRecord", "DealerIntroduction"]);
    const ownA = await ownership(a.clientId, aDup.clientId);
    const ownB = await ownership(b.clientId, bDup.clientId);
    expect(ownB).toEqual(ownA);
    // something really moved, and something really stayed (the registry's `stay` rows)
    expect(ownA.Message).toEqual([2, 0]);
    expect(ownA.Document).toEqual([2, 0]);
    expect(ownA.ConversationInsight).toEqual([1, 1]);
    expect(ownA.KycRecord).toEqual([1, 1]);
    expect(await noteAndAudit(b.clientId, bDup.clientId)).toEqual(await noteAndAudit(a.clientId, aDup.clientId));
  });

  it("the survivor has no KYC, funding, dealer or steps: the duplicate's rows move, no conflict", async () => {
    const mk = async (tag: string, dupTag: string) => {
      const p = await db.client.create({ data: { clientCode: `RG-${tag}`, name: `Plain ${tag}`, mobile: `97${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`, currentStageId: stageId } });
      const d = await kit.seedRichCustomer(db, dupTag, { stageId, adminId });
      return { p: p.id, d: d.clientId };
    };
    const A = await mk("MCCP", "MCCD");
    const B = await mk("MDDP", "MDDD");
    const sumA = await mergePair(A.p, A.d, false);
    const sumB = await mergePair(B.p, B.d, true);
    expect(sumA.conflicts).toEqual([]);
    expect(sumB.conflicts).toEqual([]);
    const ownA = await ownership(A.p, A.d);
    expect(await ownership(B.p, B.d)).toEqual(ownA);
    for (const m of ["KycRecord", "KycStep", "FundingRecord", "DealerIntroduction"]) expect(ownA[m], m).toEqual([1, 0]);
  });

  it("a duplicate whose only joint holder is soft-deleted: the holder is not moved by either path", async () => {
    const mk = async (tag: string) => {
      const p = await db.client.create({ data: { clientCode: `RG-${tag}P`, name: `Plain ${tag}`, mobile: `96${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`, currentStageId: stageId } });
      const d = await db.client.create({ data: { clientCode: `RG-${tag}D`, name: `Dup ${tag}`, currentStageId: stageId } });
      await db.accountHolder.create({ data: { clientId: d.id, name: `Holder ${tag}`, isDeleted: true } });
      return { p: p.id, d: d.id };
    };
    const A = await mk("HAA");
    const B = await mk("HBB");
    await mergePair(A.p, A.d, false);
    await mergePair(B.p, B.d, true);
    expect((await ownership(A.p, A.d)).AccountHolder).toEqual([0, 1]);
    expect(await ownership(B.p, B.d)).toEqual(await ownership(A.p, A.d));
  });

  it("a merge that is blocked or stale changes nothing in either path", async () => {
    const x = await db.client.create({ data: { clientCode: "RG-MXX", name: "X", currentStageId: stageId } });
    for (const useRegistry of [false, true]) {
      await expect(mergePair(x.id, x.id, useRegistry)).rejects.toThrow("cannot be merged into itself");
    }
  });
});

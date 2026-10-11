/**
 * Real-database check of the memory read APIs as every role: record scope (RM own customers, manager the team, admin all,
 * MARKETING and every other role nothing), the guarded actions, the decision-memory API for other modules, and a consent
 * withdrawal taking effect on reads at once.
 *   MEMORY_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch db> npx vitest run src/lib/memory/loaders.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.MEMORY_DB_TEST === "1" && local;

const NOW = new Date("2027-06-30T10:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const PROBE = "Ostrovane Kellibrand";

describe.skipIf(!enabled)("memory loaders as every role (real database)", () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let read: typeof import("./read");
  let svc: typeof import("./service");
  const id: Record<string, string> = {};
  let aiItem = ""; let humanItem = ""; let dndItem = ""; let disputedItem = "";

  beforeAll(async () => {
    db = (await import("@/lib/db/prisma")).basePrisma;
    read = await import("./read");
    svc = await import("./service");
    const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "Ld stage", sequence: 9401, slaHours: 24 } }));
    const user = (key: string, role: "RM" | "MANAGER" | "ADMIN" | "MARKETING" | "FINANCE" | "PARTNER", managerId?: string) => db.user.upsert({ where: { email: `ml-${key}@example.test` }, update: {}, create: { name: key, email: `ml-${key}@example.test`, passwordHash: "x", role, managerId } }).then((u) => (id[key] = u.id));
    await user("mgr", "MANAGER"); await user("mgr2", "MANAGER");
    await user("rm1", "RM", id.mgr); await user("rm2", "RM"); await user("admin", "ADMIN"); await user("mkt", "MARKETING"); await user("fin", "FINANCE"); await user("partner", "PARTNER");
    id.c1 = (await db.client.create({ data: { clientCode: "MLD-0001", name: PROBE, currentStageId: stage.id, assignedToId: id.rm1 } })).id;
    await db.consentRecord.create({ data: { clientId: id.c1, purpose: "AI_PROCESSING_OF_CHATS", status: "GRANTED", source: "RM_RECORDED", capturedAt: day(-30) } });
    const mk = (over: Record<string, unknown>) => db.customerMemoryItem.create({ data: { clientId: id.c1, class: "PREFERENCE", key: "preference:x", value: { text: "x" }, sourceType: "rm_entry", sourceRef: `user:${id.rm1}`, evidence: [], confidence: "HIGH", observedAt: day(-2), freshUntil: day(100), confirmation: "CONFIRMED", createdByType: "RM", ...over } as never }).then((r) => r.id);
    humanItem = await mk({ key: "preference:language", value: { text: "Prefers Hindi" } });
    aiItem = await mk({ key: "interest:PMS", class: "INTEREST", value: { assetClass: "PMS" }, sourceType: "conversation_ai", sourceRef: "insight:i1", evidence: [{ sourceRef: "insight:i1", summary: "asked about PMS", observedAt: day(-3).toISOString() }], confidence: "LOW", confirmation: "UNCONFIRMED", consentBasis: "AI_PROCESSING_OF_CHATS", createdByType: "AI_AGENT" });
    dndItem = await mk({ key: "do_not_do:calls", class: "DO_NOT_DO", value: { text: "No calls before 11" }, freshUntil: null });
    disputedItem = await mk({ key: "preference:channel", value: { channel: "sms" }, confirmation: "DISPUTED", sourceType: "conversation_ai", sourceRef: "insight:i2", consentBasis: "AI_PROCESSING_OF_CHATS", createdByType: "AI_AGENT" });
  });

  afterAll(async () => {
    if (!db) return;
    await db.customerMemoryItem.deleteMany({ where: { clientId: id.c1 } });
    await db.consentRecord.deleteMany({ where: { clientId: id.c1 } });
    await db.client.deleteMany({ where: { id: id.c1 } });
    await db.$disconnect();
  });

  const as = (key: string, role: string) => ({ userId: id[key], role });

  const cases: [string, string, string, boolean][] = [
    ["RM1 (assigned)", "rm1", "RM", true],
    ["RM2 (someone else's customer)", "rm2", "RM", false],
    ["MANAGER of RM1", "mgr", "MANAGER", true],
    ["MANAGER of nobody here", "mgr2", "MANAGER", false],
    ["ADMIN", "admin", "ADMIN", true],
    ["MARKETING", "mkt", "MARKETING", false],
    ["FINANCE", "fin", "FINANCE", false],
    ["PARTNER", "partner", "PARTNER", false],
  ];
  it.each(cases)("getCustomerMemory as %s", async (_n, key, role, sees) => {
    const v = await read.getCustomerMemory(as(key, role), id.c1, NOW);
    if (!sees) { expect(v).toBeNull(); return; }
    expect(v).not.toBeNull();
    expect(v!.counts).toMatchObject({ confirmed: 2, unconfirmed: 1, disputed: 1 });
    expect(v!.doNotDo.map((i) => i.key)).toEqual(["do_not_do:calls"]);
    expect(v!.needsConfirmation.map((i) => i.key)).toEqual(["interest:PMS"]);
  });

  it("an RM who may look but not change... every role that may see may also manage, so actions follow the same scope: the wrong RM gets 'not found' and nothing changes", async () => {
    expect(await svc.actOnMemoryAs(as("rm2", "RM"), aiItem, { type: "confirm" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await svc.actOnMemoryAs(as("mkt", "MARKETING"), aiItem, { type: "reject", reason: "x" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect((await db.customerMemoryItem.findUniqueOrThrow({ where: { id: aiItem } })).confirmation).toBe("UNCONFIRMED");
    expect(await svc.recordMemoryAs(as("rm2", "RM"), { clientId: id.c1, class: "FACT", key: "fact:employer", value: { text: "Acme" }, note: "x" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("the owning RM confirms the AI item; it becomes authoritative for other modules", async () => {
    const before = await read.getMemoryForDecisions(id.c1, NOW);
    expect(before.advisory.map((i) => i.key)).toEqual(["interest:PMS"]);
    expect(before.authoritative.map((i) => i.key).sort()).toEqual(["do_not_do:calls", "preference:language"]);
    expect(before.contested.map((i) => i.key)).toEqual(["preference:channel"]);
    expect(await svc.actOnMemoryAs(as("rm1", "RM"), aiItem, { type: "confirm" }, "Customer said so on the call today")).toMatchObject({ ok: true });
    const after = await read.getMemoryForDecisions(id.c1, NOW);
    expect(after.advisory).toEqual([]);
    expect(after.authoritative.map((i) => i.key)).toContain("interest:PMS");
  });

  it("the decision API carries no evidence text, no source refs and no name", async () => {
    const d = await read.getMemoryForDecisions(id.c1, NOW);
    const text = JSON.stringify(d);
    expect(text).not.toContain("asked about PMS");
    expect(text).not.toContain("insight:i1");
    expect(text).not.toContain(PROBE);
  });

  it("a consent withdrawal takes effect on reads at once, before any sweep: unconfirmed derived items vanish, human ones stay", async () => {
    await db.consentRecord.create({ data: { clientId: id.c1, purpose: "AI_PROCESSING_OF_CHATS", status: "WITHDRAWN", source: "RM_RECORDED", capturedAt: day(-1) } });
    const d = await read.getMemoryForDecisions(id.c1, NOW);
    expect([...d.advisory, ...d.contested].map((i) => i.key)).not.toContain("preference:channel"); // the disputed AI item
    const v = (await read.getCustomerMemory(as("rm1", "RM"), id.c1, NOW))!;
    const keys = v.groups.flatMap((g) => g.items.map((i) => i.key)).concat(v.doNotDo.map((i) => i.key));
    expect(keys).toContain("preference:language");
    expect(keys).toContain("do_not_do:calls");
    expect(keys).not.toContain("preference:channel");
    // the RM confirmed interest:PMS with a note ("Customer said so on the call"), so a person's evidence stands behind it and it stays
    expect(keys).toContain("interest:PMS");
    void humanItem; void dndItem; void disputedItem;
  });
});

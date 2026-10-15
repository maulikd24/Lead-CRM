/**
 * Real-database merge check: the duplicate's memory, complaints, commitments and household consent follow the person to the
 * survivor, and memory that now disagrees is DISPUTED rather than left side by side as two truths.
 *   MEMORY_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch db> npx vitest run src/lib/memory/merge.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.MEMORY_DB_TEST === "1" && local;

describe.skipIf(!enabled)("merge carries memory, service state and household consent (real database)", () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  const id: Record<string, string> = {};

  beforeAll(async () => {
    db = (await import("@/lib/db/prisma")).basePrisma;
    const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "Mrg stage", sequence: 9501, slaHours: 24 } }));
    id.admin = (await db.user.upsert({ where: { email: "mm-admin@example.test" }, update: {}, create: { name: "mm", email: "mm-admin@example.test", passwordHash: "x", role: "ADMIN" } })).id;
    id.keep = (await db.client.create({ data: { clientCode: "MRG-0001", name: "Keep Person", currentStageId: stage.id } })).id;
    id.dup = (await db.client.create({ data: { clientCode: "MRG-0002", name: "Dup Person", currentStageId: stage.id } })).id;
    id.other = (await db.client.create({ data: { clientCode: "MRG-0003", name: "Other Member", currentStageId: stage.id } })).id;
    const mk = (clientId: string, key: string, value: object, confirmation = "CONFIRMED") => db.customerMemoryItem.create({ data: { clientId, class: "PREFERENCE", key, value, sourceType: "rm_entry", sourceRef: `user:${id.admin}`, evidence: [], confidence: "HIGH", observedAt: new Date(), confirmation, createdByType: "RM" } as never });
    await mk(id.keep, "preference:channel", { channel: "call" });
    await mk(id.dup, "preference:channel", { channel: "sms" });
    await mk(id.keep, "preference:language", { text: "Hindi" });
    await mk(id.dup, "preference:language", { text: "hindi " }); // same value: not a conflict
    await mk(id.dup, "preference:tone", { text: "brief" });
    await db.complaint.create({ data: { clientId: id.dup, title: "Dup complaint", severity: "LOW", sourceType: "MANUAL", openedAt: new Date(), slaDueAt: new Date(Date.now() + 86_400_000) } });
    await db.commitment.create({ data: { clientId: id.dup, promisedByType: "RM", text: "Send contract note", dueAt: new Date(), sourceType: "MANUAL" } });
    const hh = await db.household.create({ data: { householdCode: "MRG-HH", name: "Merge household" } });
    id.hh = hh.id;
    await db.householdRelationshipConsent.create({ data: { householdId: hh.id, subjectClientId: id.dup, granteeClientId: id.other, scopes: ["member_identity"], status: "GRANTED", source: "RM_RECORDED" } });
    await db.householdRelationshipConsent.create({ data: { householdId: hh.id, subjectClientId: id.other, granteeClientId: id.dup, scopes: ["member_identity"], status: "GRANTED", source: "RM_RECORDED" } });
  });

  afterAll(async () => {
    if (!db) return;
    const ids = [id.keep, id.dup, id.other].filter(Boolean);
    await db.householdRelationshipConsent.deleteMany({ where: { householdId: id.hh } });
    await db.household.deleteMany({ where: { id: id.hh } });
    await db.customerMemoryItem.deleteMany({ where: { clientId: { in: ids } } });
    await db.complaint.deleteMany({ where: { clientId: { in: ids } } });
    await db.commitment.deleteMany({ where: { clientId: { in: ids } } });
    await db.activity.deleteMany({ where: { clientId: { in: ids } } });
    await db.client.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  });

  it("moves everything to the survivor, disputes what now disagrees, and leaves agreeing and new items alone", async () => {
    const { mergeClientRecords } = await import("@/lib/clients/merge");
    await db.$transaction((tx) => mergeClientRecords(tx as never, id.keep, id.dup, id.admin));

    const items = await db.customerMemoryItem.findMany({ where: { clientId: id.keep } });
    expect(items).toHaveLength(5);
    expect(await db.customerMemoryItem.count({ where: { clientId: id.dup } })).toBe(0);
    const channel = items.filter((i) => i.key === "preference:channel");
    expect(channel.map((i) => i.confirmation)).toEqual(["DISPUTED", "DISPUTED"]);
    expect(channel.map((i) => JSON.stringify(i.value)).sort()).toEqual([JSON.stringify({ channel: "call" }), JSON.stringify({ channel: "sms" })]); // neither value was overwritten
    expect(items.filter((i) => i.key === "preference:language").map((i) => i.confirmation)).toEqual(["CONFIRMED", "CONFIRMED"]);
    expect(items.find((i) => i.key === "preference:tone")!.confirmation).toBe("CONFIRMED");

    expect(await db.complaint.count({ where: { clientId: id.keep } })).toBe(1);
    expect(await db.commitment.count({ where: { clientId: id.keep } })).toBe(1);
    expect(await db.complaint.count({ where: { clientId: id.dup } })).toBe(0);
    const consents = await db.householdRelationshipConsent.findMany({ where: { householdId: id.hh } });
    expect(consents.map((c) => [c.subjectClientId, c.granteeClientId]).sort()).toEqual([[id.keep, id.other], [id.other, id.keep]].sort());
    expect(await db.auditLog.count({ where: { entity: "CustomerMemoryItem", action: "memory.disputed" } })).toBe(2);
  });
});

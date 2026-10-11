/**
 * Real-database tests of the memory store: consent at derivation, evidence that must belong to the same customer, DISPUTED
 * instead of overwrite, the human actions, the supersede chain, expiry and consent withdrawal, and an audit trail with no content.
 * Needs a throwaway local Postgres, so it is skipped unless MEMORY_DB_TEST=1 (and refuses any non-local database):
 *   MEMORY_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch db> npx vitest run src/lib/memory/store.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.MEMORY_DB_TEST === "1" && local;

const SECRET_TEXT = "Zorvath Quillby wants the statement by Friday";
const NOW = new Date("2027-06-30T10:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe.skipIf(!enabled)("customer memory store (real database)", () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let store: typeof import("./store");
  let clientId = "";
  let otherClientId = "";
  let userId = "";
  let insightA = "";
  let insightB = "";
  let otherInsight = "";
  const ai = { type: "AI_AGENT" as const, userId: null, agentKey: "memory_extractor" };

  const ev = (ref: string, summary = "prefers WhatsApp for updates") => ({ sourceRef: ref, summary, observedAt: daysAgo(2) });
  const aiProposal = (over: Record<string, unknown> = {}) => ({
    clientId,
    actor: ai,
    class: "PREFERENCE" as const,
    key: "preference:channel",
    value: { channel: "whatsapp" },
    sourceType: "conversation_ai" as const,
    sourceRef: `insight:${insightA}`,
    evidence: [ev(`insight:${insightA}`)],
    observedAt: daysAgo(2),
    now: NOW,
    ...over,
  });

  beforeAll(async () => {
    db = (await import("@/lib/db/prisma")).basePrisma;
    store = await import("./store");
    const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "Mem test stage", sequence: 9101, slaHours: 24 } }));
    const user = await db.user.upsert({ where: { email: "mem-rm@example.test" }, update: {}, create: { name: "Mem RM", email: "mem-rm@example.test", passwordHash: "x", role: "RM" } });
    userId = user.id;
    const c = await db.client.create({ data: { clientCode: "MEM-0001", name: "Memory Test One", currentStageId: stage.id, assignedToId: userId } });
    const o = await db.client.create({ data: { clientCode: "MEM-0002", name: "Memory Test Two", currentStageId: stage.id } });
    clientId = c.id;
    otherClientId = o.id;
    const mk = (cid: string, key: string) => db.conversationInsight.create({ data: { clientId: cid, kind: "INTEREST", text: SECRET_TEXT, sourceType: "NOTE", sourceRef: "n", dedupeKey: key, occurredAt: daysAgo(2) } });
    insightA = (await mk(clientId, "mem-a")).id;
    insightB = (await mk(clientId, "mem-b")).id;
    otherInsight = (await mk(otherClientId, "mem-o")).id;
    await db.consentRecord.create({ data: { clientId, purpose: "AI_PROCESSING_OF_CHATS", status: "GRANTED", source: "RM_RECORDED", capturedAt: daysAgo(30) } });
    await db.consentRecord.create({ data: { clientId, purpose: "CALL_RECORDING", status: "GRANTED", source: "RM_RECORDED", capturedAt: daysAgo(30) } });
  });

  afterAll(async () => {
    if (!db) return;
    const ids = (await db.client.findMany({ where: { clientCode: { in: ["MEM-0001", "MEM-0002"] } }, select: { id: true } })).map((c) => c.id);
    await db.customerMemoryItem.deleteMany({ where: { clientId: { in: ids } } });
    await db.conversationInsight.deleteMany({ where: { clientId: { in: ids } } });
    await db.consentRecord.deleteMany({ where: { clientId: { in: ids } } });
    await db.client.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  });

  const rows = (key?: string) => db.customerMemoryItem.findMany({ where: { clientId, ...(key ? { key } : {}) }, orderBy: { createdAt: "asc" } });

  it("an AI proposal is stored UNCONFIRMED with medium-or-lower confidence, a consent basis and an audit row", async () => {
    const r = await store.writeMemoryItem(aiProposal());
    expect(r).toMatchObject({ ok: true, outcome: "created", confirmation: "UNCONFIRMED" });
    const [item] = await rows("preference:channel");
    expect(item).toMatchObject({ confirmation: "UNCONFIRMED", consentBasis: "AI_PROCESSING_OF_CHATS", createdByType: "AI_AGENT" });
    expect(item.confidence).not.toBe("HIGH");
    expect(await db.auditLog.count({ where: { entity: "CustomerMemoryItem", entityId: item.id, action: "memory.proposed" } })).toBe(1);
  });

  it("the audit chain carries ids and states, never the item's value or evidence text", async () => {
    const audits = await db.auditLog.findMany({ where: { entity: "CustomerMemoryItem" } });
    expect(audits.length).toBeGreaterThan(0);
    const text = JSON.stringify(audits, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(text).not.toContain("whatsapp");
    expect(text).not.toContain("WhatsApp for updates");
  });

  it("refuses an AI item without consent at derivation time (R6)", async () => {
    const r = await store.writeMemoryItem(aiProposal({ clientId: otherClientId, sourceRef: `insight:${otherInsight}`, evidence: [ev(`insight:${otherInsight}`)] }));
    expect(r).toMatchObject({ ok: false, code: "CONSENT_MISSING" });
    expect(await db.customerMemoryItem.count({ where: { clientId: otherClientId } })).toBe(0);
  });

  it("refuses evidence that belongs to another customer, and refs that do not exist (R2)", async () => {
    expect(await store.writeMemoryItem(aiProposal({ key: "preference:x", sourceRef: `insight:${otherInsight}`, evidence: [ev(`insight:${otherInsight}`)] }))).toMatchObject({ ok: false, code: "SOURCE_NOT_FOUND" });
    expect(await store.writeMemoryItem(aiProposal({ key: "preference:y", sourceRef: "insight:does-not-exist", evidence: [ev("insight:does-not-exist")] }))).toMatchObject({ ok: false, code: "SOURCE_NOT_FOUND" });
  });

  it("refuses a sensitive inference and an AI source written by a person", async () => {
    expect(await store.writeMemoryItem(aiProposal({ class: "FACT", key: "fact:health", value: { text: "has diabetes" } }))).toMatchObject({ ok: false, code: "SENSITIVE_TOPIC" });
    expect(await store.writeMemoryItem(aiProposal({ key: "preference:z", actor: { type: "RM", userId } }))).toMatchObject({ ok: false, code: "ACTOR_REQUIRED" });
  });

  it("the same observation again adds evidence and raises confidence, with no duplicate row", async () => {
    const r = await store.writeMemoryItem(aiProposal({ sourceRef: `insight:${insightB}`, evidence: [ev(`insight:${insightB}`)] }));
    expect(r).toMatchObject({ ok: true, outcome: "reaffirmed" });
    const items = await rows("preference:channel");
    expect(items).toHaveLength(1);
    expect(items[0].confidence).toBe("MEDIUM");
    expect((items[0].evidence as unknown[]).length).toBe(2);
    expect(items[0].confirmation).toBe("UNCONFIRMED"); // seeing it twice never confirms it
  });

  it("a conflicting new item is stored DISPUTED, the old item is disputed too if unconfirmed, and no value changes", async () => {
    const before = (await rows("preference:channel"))[0];
    const r = await store.writeMemoryItem(aiProposal({ value: { channel: "call" }, sourceRef: `insight:${insightB}`, evidence: [ev(`insight:${insightB}`, "asked to be called")] }));
    expect(r).toMatchObject({ ok: true, outcome: "created", confirmation: "DISPUTED" });
    const items = await rows("preference:channel");
    expect(items).toHaveLength(2);
    const old = items.find((i) => i.id === before.id)!;
    expect(old.value).toEqual({ channel: "whatsapp" }); // never overwritten
    expect(old.confirmation).toBe("DISPUTED");
    const fresh = items.find((i) => i.id !== before.id)!;
    expect(fresh.confirmation).toBe("DISPUTED");
    expect(fresh.conflictsWithId).toBe(before.id);
  });

  it("a person settles the dispute by confirming one: the other is SUPERSEDED, and a confirm needs a named person", async () => {
    const items = await rows("preference:channel");
    const chosen = items.find((i) => (i.value as { channel: string }).channel === "call")!;
    expect(await store.actOnMemoryItem(chosen.id, { type: "confirm", actorId: "system" })).toMatchObject({ ok: false, code: "ACTOR_REQUIRED" });
    expect(await store.actOnMemoryItem(chosen.id, { type: "confirm", actorId: userId }, { note: "She told me on the phone today", now: NOW })).toMatchObject({ ok: true });
    const after = await rows("preference:channel");
    expect(after.find((i) => i.id === chosen.id)).toMatchObject({ confirmation: "CONFIRMED", confirmedById: userId, confidence: "HIGH" });
    expect(after.find((i) => i.id !== chosen.id)).toMatchObject({ confirmation: "SUPERSEDED", supersededById: chosen.id });
    expect(await db.auditLog.count({ where: { entity: "CustomerMemoryItem", entityId: chosen.id, action: "memory.confirmed" } })).toBe(1);
  });

  it("an AI proposal that disagrees with a CONFIRMED item is DISPUTED and leaves the confirmed item confirmed", async () => {
    const r = await store.writeMemoryItem(aiProposal({ value: { channel: "email" }, sourceRef: `insight:${insightA}`, evidence: [ev(`insight:${insightA}`, "mentioned email")] }));
    expect(r).toMatchObject({ ok: true, confirmation: "DISPUTED" });
    const confirmed = (await rows("preference:channel")).find((i) => i.confirmation === "CONFIRMED")!;
    expect(confirmed.value).toEqual({ channel: "call" });
  });

  it("reject needs a reason, records who, and stops the AI re-deriving the same thing for 90 days (R7)", async () => {
    const disputed = (await rows("preference:channel")).find((i) => i.confirmation === "DISPUTED" && (i.value as { channel: string }).channel === "email")!;
    expect(await store.actOnMemoryItem(disputed.id, { type: "reject", actorId: userId, reason: " " })).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    expect(await store.actOnMemoryItem(disputed.id, { type: "reject", actorId: userId, reason: "Not what she said" }, { now: NOW })).toMatchObject({ ok: true });
    expect(await db.customerMemoryItem.findUniqueOrThrow({ where: { id: disputed.id } })).toMatchObject({ confirmation: "REJECTED", rejectedById: userId, rejectedReason: "Not what she said" });
    const again = await store.writeMemoryItem(aiProposal({ value: { channel: "email" }, evidence: [ev(`insight:${insightA}`, "mentioned email again")] }));
    expect(again).toMatchObject({ ok: true, outcome: "suppressed", reason: "REJECTED_RECENTLY" });
    const later = await store.writeMemoryItem(aiProposal({ value: { channel: "email" }, evidence: [ev(`insight:${insightA}`, "mentioned email again")], now: new Date(NOW.getTime() + 100 * 86_400_000) }));
    expect(later).toMatchObject({ ok: true, outcome: "created" });
  });

  it("an edit supersedes the old item with a new CONFIRMED one and keeps the chain", async () => {
    const r = await store.writeMemoryItem({ clientId, actor: { type: "RM", userId }, class: "FACT", key: "fact:employer", value: { text: "Acme Ltd" }, sourceType: "rm_entry", sourceRef: `user:${userId}`, evidence: [ev(`user:${userId}`, "RM entered from the KYC form")], observedAt: daysAgo(1), now: NOW });
    expect(r).toMatchObject({ ok: true, confirmation: "CONFIRMED" });
    const first = (await rows("fact:employer"))[0];
    expect(await store.editMemoryItem(first.id, { value: { text: "Acme Pvt Ltd" }, actorId: userId, reason: "Company renamed" }, { now: NOW })).toMatchObject({ ok: true });
    const chain = await rows("fact:employer");
    expect(chain).toHaveLength(2);
    expect(chain.find((i) => i.id === first.id)).toMatchObject({ confirmation: "SUPERSEDED" });
    const head = chain.find((i) => i.id !== first.id)!;
    expect(head).toMatchObject({ confirmation: "CONFIRMED", sourceType: "rm_entry" });
    expect(chain.find((i) => i.id === first.id)!.supersededById).toBe(head.id);
  });

  it("an observation that is already past its freshness window is not stored at all", async () => {
    const r = await store.writeMemoryItem(aiProposal({ class: "INTEREST", key: "interest:Bonds", value: { assetClass: "Bonds" }, observedAt: daysAgo(100), evidence: [ev(`insight:${insightA}`, "asked about bonds")] }));
    expect(r).toMatchObject({ ok: true, outcome: "suppressed", reason: "ALREADY_STALE" });
    expect(await rows("interest:Bonds")).toHaveLength(0);
  });

  it("expireDueMemoryItems moves lapsed items to EXPIRED with an audit row", async () => {
    await store.writeMemoryItem(aiProposal({ class: "INTEREST", key: "interest:PMS", value: { assetClass: "PMS" }, sourceRef: `insight:${insightA}`, evidence: [ev(`insight:${insightA}`, "asked about PMS")], observedAt: daysAgo(30) }));
    expect((await rows("interest:PMS"))[0].confirmation).toBe("UNCONFIRMED"); // 60-day window, 30 days used
    const r = await store.expireDueMemoryItems({ now: new Date(NOW.getTime() + 40 * 86_400_000) });
    expect(r.expired).toBeGreaterThanOrEqual(1);
    const item = (await rows("interest:PMS"))[0];
    expect(item.confirmation).toBe("EXPIRED");
    expect(await db.auditLog.count({ where: { entity: "CustomerMemoryItem", entityId: item.id, action: "memory.expired" } })).toBe(1);
  });

  it("a consent withdrawal expires derived UNCONFIRMED items, and keeps a CONFIRMED one only when independently supported (R6)", async () => {
    await store.writeMemoryItem(aiProposal({ class: "OBJECTION", key: "objection:fees", value: { text: "fees too high" }, sourceRef: `insight:${insightA}`, evidence: [ev(`insight:${insightA}`, "fees too high")] }));
    await store.writeMemoryItem(aiProposal({ class: "OBJECTION", key: "objection:timing", value: { text: "wants to wait" }, sourceRef: `insight:${insightA}`, evidence: [ev(`insight:${insightA}`, "wants to wait")] }));
    await store.writeMemoryItem(aiProposal({ class: "OBJECTION", key: "objection:trust", value: { text: "unsure about trust" }, sourceRef: `insight:${insightA}`, evidence: [ev(`insight:${insightA}`, "unsure")] }));
    const byKey = async (k: string) => (await rows(k))[0];
    // confirmed with an RM note (independent) vs confirmed by click only (not independent)
    await store.actOnMemoryItem((await byKey("objection:timing")).id, { type: "confirm", actorId: userId }, { note: "She said so in the branch", now: NOW });
    await store.actOnMemoryItem((await byKey("objection:trust")).id, { type: "confirm", actorId: userId }, { now: NOW });
    const r = await store.expireOnConsentWithdrawal(clientId, "AI_PROCESSING_OF_CHATS", { now: NOW });
    expect(r.kept).toBe(2); // the earlier channel preference (confirmed with an RM note) and the timing objection
    expect((await byKey("objection:fees")).confirmation).toBe("EXPIRED");
    expect((await byKey("objection:timing")).confirmation).toBe("CONFIRMED");
    expect((await byKey("objection:trust")).confirmation).toBe("EXPIRED");
    // call-derived items are untouched by a chat-consent withdrawal
    expect(await db.customerMemoryItem.count({ where: { clientId, consentBasis: "CALL_RECORDING", confirmation: "EXPIRED" } })).toBe(0);
  });

  it("backfill from existing data: language, manual acceptance and an active snooze become confirmed items; automatic levels are not copied; re-running adds nothing", async () => {
    const { backfillMemoryForClient } = await import("./backfill");
    const stage = (await db.stage.findFirstOrThrow());
    const c = await db.client.create({ data: { clientCode: "MEM-0003", name: "Memory Test Three", currentStageId: stage.id, preferredLanguage: "Hindi" } });
    await db.assetClassAcceptance.createMany({ data: [{ clientId: c.id, assetClass: "PMS", level: "LOW", source: "manual", reason: "RM call", isManual: true, updatedAt: daysAgo(3) }, { clientId: c.id, assetClass: "AIF", level: "LOW", source: "rule", reason: "auto", isManual: false, updatedAt: daysAgo(3) }] });
    await db.suggestionDismissal.create({ data: { clientId: c.id, ruleKey: "idle_cash", fingerprint: "1", dismissedById: userId, snoozeUntil: new Date(NOW.getTime() + 20 * 86_400_000) } });
    const first = await backfillMemoryForClient(c.id, NOW);
    expect(first).toMatchObject({ proposed: 3, created: 3, refused: 0 });
    const items = await db.customerMemoryItem.findMany({ where: { clientId: c.id }, orderBy: { key: "asc" } });
    expect(items.map((i) => i.key)).toEqual(["do_not_do:suggestion:idle_cash", "preference:language", "product_stance:PMS"]);
    expect(items.every((i) => i.confirmation === "CONFIRMED")).toBe(true);
    expect(items.every((i) => !["conversation_ai", "call_ai"].includes(i.sourceType))).toBe(true);
    const again = await backfillMemoryForClient(c.id, NOW);
    expect(again).toMatchObject({ created: 0 });
    expect(await db.customerMemoryItem.count({ where: { clientId: c.id } })).toBe(3);
    await db.customerMemoryItem.deleteMany({ where: { clientId: c.id } });
    await db.suggestionDismissal.deleteMany({ where: { clientId: c.id } });
    await db.assetClassAcceptance.deleteMany({ where: { clientId: c.id } });
    await db.client.delete({ where: { id: c.id } });
  });
});

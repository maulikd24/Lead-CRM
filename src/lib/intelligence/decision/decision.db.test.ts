/**
 * Real-database checks of the Decision Engine (shadow): the loader reads the customer's real rows, the stored decision carries the
 * suppression and policy results, an unchanged customer gets no new row, a replaced decision expires, and the foreign keys behave
 * (RESTRICT to Client, CASCADE to feedback, outcomes and the disagreement row). Skipped unless DECISION_DB_TEST=1 and DATABASE_URL is local.
 *   DECISION_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<wt_w2a_scratch> npx vitest run src/lib/intelligence/decision/decision.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("react", async () => ({ ...(await vi.importActual<typeof import("react")>("react")), cache: <T,>(fn: T) => fn }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.DECISION_DB_TEST === "1" && local && /\/wt_[a-z0-9_]+$/.test(url);
const DAY = 86_400_000;

describe.skipIf(!enabled)("decision engine (real database)", { timeout: 90_000 }, () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let runShadowDecision: typeof import("./shadow").runShadowDecision;
  let stageId = "";
  let userId = "";
  const made: string[] = [];
  const now = new Date();

  async function client(code: string, over: Record<string, unknown> = {}) {
    const c = await db.client.create({ data: { clientCode: code, name: `Decision Test ${code}`, currentStageId: stageId, assignedToId: userId, status: "ACTIVE", ...over } });
    made.push(c.id);
    return c;
  }

  beforeAll(async () => {
    db = (await import("@/lib/db/prisma")).basePrisma;
    ({ runShadowDecision } = await import("./shadow"));
    const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "Decision test stage", sequence: 9101, slaHours: 24 } }));
    stageId = stage.id;
    const rm = await db.user.upsert({ where: { email: "decision-db-rm@example.test" }, update: {}, create: { email: "decision-db-rm@example.test", name: "Decision RM", passwordHash: "x", role: "RM" } });
    userId = rm.id;
  });

  afterAll(async () => {
    await db.decisionRecord.deleteMany({ where: { clientId: { in: made } } });
    await db.consentRecord.deleteMany({ where: { clientId: { in: made } } });
    await db.conversationInsight.deleteMany({ where: { clientId: { in: made } } });
    await db.suggestionDismissal.deleteMany({ where: { clientId: { in: made } } });
    await db.client.deleteMany({ where: { id: { in: made } } });
    await db.user.deleteMany({ where: { email: "decision-db-rm@example.test" } });
  });

  it("stores a decision with evidence, suppression and policy, and a second run with nothing changed adds no row", async () => {
    const c = await client("DEC-A1");
    const first = await runShadowDecision(c.id, { now });
    expect(first?.created).toBe(true);
    const again = await runShadowDecision(c.id, { now });
    expect(again?.created).toBe(false);
    expect(again?.id).toBe(first?.id);
    const row = await db.decisionRecord.findUniqueOrThrow({ where: { id: first!.id } });
    expect(row.mode).toBe("SHADOW");
    expect(row.engineVersion).toMatch(/^nba-v2/);
    expect(row.correlationId).toMatch(/^corr_/);
    expect(Array.isArray(row.evidence)).toBe(true);
    expect(["RECOMMEND", "NO_ACTION", "ABSTAIN"]).toContain(row.result);
    expect(await db.decisionRecord.count({ where: { clientId: c.id } })).toBe(1);
  });

  it("an open complaint is stored as a suppression and no sales topic wins; do-not-contact abstains", async () => {
    const c = await client("DEC-B1", { productInterest: "PMS", expectedInvestment: 5_000_000 });
    await db.conversationInsight.create({ data: { clientId: c.id, kind: "COMPLAINT", text: "Statement was wrong", status: "OPEN", severity: "high", sourceType: "NOTE", sourceRef: "n1", dedupeKey: `dec-b1-${now.getTime()}`, occurredAt: new Date(now.getTime() - 2 * DAY) } });
    const r = await runShadowDecision(c.id, { now });
    const row = await db.decisionRecord.findUniqueOrThrow({ where: { id: r!.id } });
    expect(row.assetClass).toBeNull();
    const sup = row.suppression as { rule: string }[];
    expect(row.programme).toBe("Service / relationship follow-up");
    expect(row.result).toBe("RECOMMEND");
    expect(sup.some((x) => x.rule === "open_complaint")).toBe(true);
    await db.consentRecord.create({ data: { clientId: c.id, purpose: "DO_NOT_CONTACT", status: "GRANTED", source: "RM_RECORDED", capturedAt: new Date(now.getTime() - DAY) } });
    const r2 = await runShadowDecision(c.id, { now });
    const row2 = await db.decisionRecord.findUniqueOrThrow({ where: { id: r2!.id } });
    expect(r2!.created).toBe(true);
    expect(row2.result).toBe("ABSTAIN");
    expect(row2.abstainReason).toBe("do_not_contact");
    expect(row2.channel).toBe("none");
    // the first decision was replaced without anyone acting on it: expired, with a system feedback row
    const old = await db.decisionRecord.findUniqueOrThrow({ where: { id: r!.id } });
    expect(old.status).toBe("EXPIRED");
    expect((await db.decisionFeedback.findMany({ where: { decisionId: r!.id } })).map((f) => f.kind)).toContain("expired");
    expect(row2.causationId).toBe(r!.id);
  });

  it("the loader reads a do-not-recommend entry from SuggestionDismissal into the gate context", async () => {
    const c = await client("DEC-C1", { status: "ACTIVE" });
    await db.suggestionDismissal.create({ data: { clientId: c.id, ruleKey: "nba.dnr", fingerprint: "dnr:PMS", reason: "Customer asked", snoozeUntil: new Date(now.getTime() + 100 * DAY) } });
    const { loadDecisionInput } = await import("./loader");
    const input = await loadDecisionInput(c.id, { now });
    expect(input!.gate.dismissals.map((d) => `${d.ruleKey}|${d.fingerprint}`)).toEqual(["nba.dnr|dnr:PMS"]);
    expect(input!.gate.consent.policy).toBeDefined();
  });

  it("foreign keys: the client cannot be deleted while a decision exists; deleting the decision cascades feedback, outcomes and the disagreement row", async () => {
    const c = await client("DEC-D1");
    const r = await runShadowDecision(c.id, { now });
    const id = r!.id;
    await db.decisionFeedback.create({ data: { decisionId: id, userId, kind: "accept" } });
    await db.decisionOutcome.create({ data: { decisionId: id, kind: "contact", eventRef: "a1", occurredAt: now, daysAfter: 1 } });
    await db.decisionDisagreement.upsert({ where: { decisionId: id }, update: {}, create: { decisionId: id, kind: "programme_differs", severity: "minor", summary: "x" } });
    await expect(db.client.delete({ where: { id: c.id } })).rejects.toThrow();
    await db.decisionRecord.deleteMany({ where: { clientId: c.id } });
    expect(await db.decisionFeedback.count({ where: { decisionId: id } })).toBe(0);
    expect(await db.decisionOutcome.count({ where: { decisionId: id } })).toBe(0);
    expect(await db.decisionDisagreement.count({ where: { decisionId: id } })).toBe(0);
    await db.client.delete({ where: { id: c.id } });
    made.splice(made.indexOf(c.id), 1);
  });

  it("one outcome per decision, kind and event (idempotent linking)", async () => {
    const c = await client("DEC-E1");
    const r = await runShadowDecision(c.id, { now });
    await db.decisionOutcome.create({ data: { decisionId: r!.id, kind: "contact", eventRef: "z", occurredAt: now, daysAfter: 0 } });
    await expect(db.decisionOutcome.create({ data: { decisionId: r!.id, kind: "contact", eventRef: "z", occurredAt: now, daysAfter: 0 } })).rejects.toThrow();
  });
});

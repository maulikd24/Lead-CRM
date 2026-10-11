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
    // The test RM stays: the audit log is append-only and now references it (the database is a throwaway scratch one).
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
    await db.suggestionDismissal.create({ data: { clientId: c.id, ruleKey: "nba.dnr", fingerprint: "dnr:PMS", reason: "Customer asked", dismissedAt: new Date(now.getTime() - DAY), snoozeUntil: new Date(now.getTime() + 100 * DAY) } });
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

  describe("feedback and outcomes", () => {
    it("Accept creates a Task for the assigned RM, writes feedback and an audit row, and sends nothing", async () => {
      const { applyFeedback } = await import("./feedback-db");
      const c = await client("DEC-F1");
      const r = await runShadowDecision(c.id, { now });
      const msgBefore = await db.message.count({ where: { clientId: c.id } });
      const res = await applyFeedback({ decisionId: r!.id, viewer: { id: userId, role: "RM" }, visibleUserIds: [userId], feedback: { kind: "accept" }, env: { NBA_RM_VISIBLE: "1" }, now });
      expect(res).toMatchObject({ ok: true, status: "ACCEPTED" });
      if (res.ok) {
        const task = await db.task.findUniqueOrThrow({ where: { id: res.taskId! } });
        expect(task.assignedToId).toBe(userId);
        expect(task.source).toBe(`nba:${r!.id}`);
      }
      expect((await db.decisionFeedback.findMany({ where: { decisionId: r!.id } })).map((f) => f.kind)).toContain("accept");
      expect((await db.decisionRecord.findUniqueOrThrow({ where: { id: r!.id } })).status).toBe("ACCEPTED");
      expect(await db.auditLog.count({ where: { entity: "DecisionRecord", entityId: r!.id, action: "decision_feedback_accept" } })).toBe(1);
      expect(await db.message.count({ where: { clientId: c.id } })).toBe(msgBefore);
      await db.task.deleteMany({ where: { clientId: c.id } });
    });

    it("Wrong and Snooze write a dismissal on the chosen rule so the same item stays away; Do-not-recommend writes a scoped, expiring one", async () => {
      const { applyFeedback } = await import("./feedback-db");
      const c = await client("DEC-F2");
      const r = await runShadowDecision(c.id, { now });
      const before = await db.decisionRecord.findUniqueOrThrow({ where: { id: r!.id } });
      expect(before.chosenRuleKey).toBeTruthy();
      const viewer = { id: userId, role: "RM" };
      const env = { NBA_RM_VISIBLE: "1" };
      expect(await applyFeedback({ decisionId: r!.id, viewer, visibleUserIds: [userId], feedback: { kind: "snooze", days: 3 }, env, now })).toMatchObject({ ok: true, status: "SNOOZED" });
      const d = await db.suggestionDismissal.findFirstOrThrow({ where: { clientId: c.id, ruleKey: before.chosenRuleKey! } });
      expect(d.fingerprint).toBe(before.chosenFingerprint);
      expect(d.snoozeUntil.getTime()).toBe(now.getTime() + 3 * DAY);
      expect(await applyFeedback({ decisionId: r!.id, viewer, visibleUserIds: [userId], feedback: { kind: "wrong", reason: "free text not allowed" }, env, now })).toMatchObject({ ok: false });
    });

    it("an RM cannot act on another RM's customer, or at all without the RM flag; marketing never", async () => {
      const { applyFeedback } = await import("./feedback-db");
      const c = await client("DEC-F3");
      const r = await runShadowDecision(c.id, { now });
      const base = { decisionId: r!.id, feedback: { kind: "done" } as const, now };
      expect(await applyFeedback({ ...base, viewer: { id: userId, role: "RM" }, visibleUserIds: [userId], env: {} })).toEqual({ ok: false, error: "Decision not found" });
      expect(await applyFeedback({ ...base, viewer: { id: "someone-else", role: "RM" }, visibleUserIds: ["someone-else"], env: { NBA_RM_VISIBLE: "1" } })).toEqual({ ok: false, error: "Decision not found" });
      expect(await applyFeedback({ ...base, viewer: { id: "m", role: "MARKETING" }, visibleUserIds: null, env: { NBA_RM_VISIBLE: "1" } })).toEqual({ ok: false, error: "Decision not found" });
      expect(await applyFeedback({ ...base, viewer: { id: userId, role: "ADMIN" }, visibleUserIds: null, env: {} })).toMatchObject({ ok: true });
    });

    it("links a later contact and a conversation outcome to the decision once, never one before it, with the correlation note available", async () => {
      const { linkOutcomesForClient } = await import("./outcomes-db");
      const c = await client("DEC-G1");
      const decided = new Date(now.getTime() - 3 * DAY);
      const r = await runShadowDecision(c.id, { now: decided });
      await db.decisionRecord.update({ where: { id: r!.id }, data: { createdAt: decided } });
      await db.interactionOutcome.create({ data: { clientId: c.id, outcome: "FOLLOW_UP", channel: "CALL", actorType: "RM", createdAt: new Date(decided.getTime() - DAY) } });
      await db.interactionOutcome.create({ data: { clientId: c.id, outcome: "INTERESTED", channel: "CALL", actorType: "RM", createdAt: new Date(decided.getTime() + DAY) } });
      expect(await linkOutcomesForClient(c.id, now)).toBe(1);
      expect(await linkOutcomesForClient(c.id, now)).toBe(0);
      const links = await db.decisionOutcome.findMany({ where: { decisionId: r!.id } });
      expect(links.map((l) => l.kind)).toEqual(["interaction_outcome"]);
      expect(links[0].daysAfter).toBe(1);
      await db.interactionOutcome.deleteMany({ where: { clientId: c.id } });
    });

    it("retention deletes unreviewed decisions after 180 days and reviewed ones after 24 months, children with them, and is safe to run twice", async () => {
      const { runDecisionRetention } = await import("./retention-db");
      const c = await client("DEC-R1");
      const mk = (ageDays: number, tag: string) => db.decisionRecord.create({ data: { clientId: c.id, engineVersion: "test", correlationId: `corr_${tag}`, result: "NO_ACTION", action: "No Action", programme: "Complete KYC", reason: tag, priority: "Low", priorityScore: 1, owner: "RM", channel: "none", timing: "Later", confidence: "low", evidence: [], scoreInputs: [], suppression: [], policyResult: {}, alternatives: [], inputHash: tag, observedAt: now, createdAt: new Date(now.getTime() - ageDays * DAY) } });
      const oldUnreviewed = await mk(200, "r-old-unreviewed");
      const oldSystemOnly = await mk(201, "r-old-system-only");
      const oldReviewed = await mk(200, "r-old-reviewed");
      const ancientReviewed = await mk(800, "r-ancient-reviewed");
      const recent = await mk(10, "r-recent");
      await db.decisionFeedback.create({ data: { decisionId: oldSystemOnly.id, userId: "system", kind: "expired" } });
      for (const d of [oldReviewed, ancientReviewed]) await db.decisionFeedback.create({ data: { decisionId: d.id, userId, kind: "done" } });
      const first = await runDecisionRetention({ now });
      expect(first.deleted).toBeGreaterThanOrEqual(3);
      const left = (await db.decisionRecord.findMany({ where: { clientId: c.id }, select: { id: true } })).map((r) => r.id).sort();
      expect(left).toEqual([oldReviewed.id, recent.id].sort());
      expect(await db.decisionFeedback.count({ where: { decisionId: { in: [oldUnreviewed.id, oldSystemOnly.id, ancientReviewed.id] } } })).toBe(0);
      expect((await runDecisionRetention({ now })).deleted).toBe(0);
    });
  });
});

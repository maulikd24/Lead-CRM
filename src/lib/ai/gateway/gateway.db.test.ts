/**
 * The AI gateway against a real database: the trace row, the budget total, the kill-switch setting, the consent ledger, retention
 * and the audited autonomy change. Skipped unless AI_GATEWAY_DB_TEST=1 (and refuses any non-local database):
 *   AI_GATEWAY_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch db> npx vitest run src/lib/ai/gateway/gateway.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.AI_GATEWAY_DB_TEST === "1" && local;

describe.skipIf(!enabled)("AI gateway against a real database", () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let gw: typeof import("./gateway");
  let wiring: typeof import("./wiring");
  let FakeProvider: typeof import("@/lib/ai/provider").FakeProvider;
  let clientId = "";
  let adminId = "";
  const tag = `gwdb-${Date.now()}`;

  const depsFor = (env: Record<string, string | undefined>, reply: string | { text: string; inputTokens: number; outputTokens: number; model: string } = "ok") => {
    const fake = new FakeProvider(reply);
    return { fake, deps: { ...wiring.defaultGatewayDeps(env as NodeJS.ProcessEnv), providerFor: () => fake } };
  };

  beforeAll(async () => {
    ({ basePrisma: db } = await import("@/lib/db/prisma"));
    gw = await import("./gateway");
    wiring = await import("./wiring");
    ({ FakeProvider } = await import("@/lib/ai/provider"));
    const stage = await db.stage.findFirstOrThrow();
    clientId = (await db.client.create({ data: { clientCode: `GW-${tag}`, name: "Gateway Test", mobile: "9000000001", mobileKey: "9000000001", currentStageId: stage.id } })).id;
    adminId = (await db.user.upsert({ where: { email: `${tag}@example.test` }, update: {}, create: { email: `${tag}@example.test`, name: "Gateway Admin", role: "ADMIN", passwordHash: "x" } })).id;
  });
  afterAll(async () => {
    await db.agentRun.deleteMany({ where: { OR: [{ correlationId: { startsWith: tag } }, { purposeId: "made.up" }] } });
    await db.consentRecord.deleteMany({ where: { clientId } });
    await db.agentAutonomy.deleteMany({ where: { agentKey: "wa_nudger" } });
    await db.agentSetting.deleteMany({ where: { agentKey: "social_drafter" } });
    await db.client.delete({ where: { id: clientId } }).catch(() => {});
  });

  it("stores one trace row per call with the enum status, cost, ids and retention, and no prompt or output", async () => {
    const { deps } = depsFor({ AI_BUDGET_DEFAULT_USD: "100" }, { text: "OUTPUT-TEXT-XYZ", inputTokens: 1000, outputTokens: 200, model: "gpt-4o-mini" });
    const r = await gw.callModel({ purpose: "summary.page", system: "s", user: "PROMPT-TEXT-XYZ", correlationId: `${tag}-a`, approvalRef: "appr-1", subject: { type: "client", id: clientId } }, deps);
    expect(r.kind).toBe("ok");
    const row = await db.agentRun.findFirstOrThrow({ where: { correlationId: `${tag}-a` } });
    expect(row).toMatchObject({ status: "OK", purposeId: "summary.page", agentKey: "ai_summaries", provider: "openai", inputTokens: 1000, outputTokens: 200, approvalRef: "appr-1", subjectType: "client", subjectId: clientId, inputClass: "customer_facts" });
    expect(Number(row.costUsdEstimate)).toBeCloseTo(0.00027, 6);
    expect(row.retainUntil.getTime() - row.createdAt.getTime()).toBeGreaterThan(89 * 86_400_000);
    expect(JSON.stringify(row)).not.toMatch(/XYZ/);
  });

  it("the daily budget reads real spend: once the cap is reached the next call is refused", async () => {
    const env = { AI_PURPOSE_BUDGETS_USD: "summary.page=0.0003" }; // 0.00027 already spent today by the first test
    const { deps, fake } = depsFor(env);
    const before = fake.calls.length;
    const r = await gw.callModel({ purpose: "summary.page", user: "x", correlationId: `${tag}-b` }, deps);
    expect(r).toMatchObject({ kind: "blocked", reason: "budget_exceeded" });
    expect(fake.calls.length).toBe(before);
    expect((await db.agentRun.findFirstOrThrow({ where: { correlationId: `${tag}-b` } })).status).toBe("BLOCKED");
  });

  it("the agent's kill switch is the real AgentSetting row AND its env flag", async () => {
    const base = { AI_BUDGET_DEFAULT_USD: "100" };
    const off = await gw.callModel({ purpose: "social.draft", user: "x", correlationId: `${tag}-k1` }, depsFor({ ...base, SOCIAL_DRAFTS_ENABLED: "1" }).deps);
    expect(off).toMatchObject({ kind: "blocked", reason: "kill_switch" }); // no row yet: off
    await db.agentSetting.upsert({ where: { agentKey: "social_drafter" }, create: { agentKey: "social_drafter", enabled: true }, update: { enabled: true } });
    expect((await gw.callModel({ purpose: "social.draft", user: "x", correlationId: `${tag}-k2` }, depsFor({ ...base, SOCIAL_DRAFTS_ENABLED: "1" }).deps)).kind).toBe("ok");
    expect(await gw.callModel({ purpose: "social.draft", user: "x", correlationId: `${tag}-k3` }, depsFor({ ...base }).deps)).toMatchObject({ kind: "blocked", reason: "kill_switch" }); // flag off
  });

  it("consent comes from the real ledger: none blocks, granted passes, withdrawn blocks", async () => {
    const env = { AI_BUDGET_DEFAULT_USD: "100", CONSENT_ENFORCEMENT: "1", WA_ASSIST_ENABLED: "1" };
    const call = (n: string) => gw.callModel({ purpose: "reply.suggest", user: "{}", subject: { type: "client", id: clientId }, correlationId: `${tag}-${n}` }, depsFor(env).deps);
    await db.agentSetting.upsert({ where: { agentKey: "wa_reply" }, create: { agentKey: "wa_reply", enabled: true }, update: { enabled: true } });
    const rec = (purpose: string, status: string, at: string) => db.consentRecord.create({ data: { clientId, purpose, channel: "whatsapp", status, source: "RM_RECORDED", capturedAt: new Date(at) } });
    try {
      expect(await call("c0")).toMatchObject({ kind: "blocked", reason: "consent_denied" });
      await rec("AI_PROCESSING_OF_CHATS", "GRANTED", "2026-01-01T00:00:00Z");
      expect((await call("c1")).kind).toBe("ok");
      await rec("AI_PROCESSING_OF_CHATS", "WITHDRAWN", "2026-02-01T00:00:00Z");
      expect(await call("c2")).toMatchObject({ kind: "blocked", reason: "consent_denied" });
    } finally {
      await db.agentSetting.deleteMany({ where: { agentKey: "wa_reply" } });
    }
  });

  it("do-not-contact in the real ledger makes a marketing-consented customer ABSTAIN with do_not_contact", async () => {
    const env = { AI_BUDGET_DEFAULT_USD: "100", CONSENT_ENFORCEMENT: "1", AGENT_NUDGER_ENABLED: "1" };
    await db.agentSetting.upsert({ where: { agentKey: "wa_nudger" }, create: { agentKey: "wa_nudger", enabled: true }, update: { enabled: true } });
    const rec = (purpose: string, status: string, at: string) => db.consentRecord.create({ data: { clientId, purpose, channel: "whatsapp", status, source: "RM_RECORDED", capturedAt: new Date(at) } });
    try {
      await rec("MARKETING_COMMS", "GRANTED", "2026-01-01T00:00:00Z");
      expect((await gw.callModel({ purpose: "nudger.draft", user: "{}", subject: { type: "client", id: clientId }, correlationId: `${tag}-n1` }, depsFor(env).deps)).kind).toBe("ok");
      await rec("DO_NOT_CONTACT", "GRANTED", "2026-04-01T00:00:00Z");
      expect(await gw.callModel({ purpose: "nudger.draft", user: "{}", subject: { type: "client", id: clientId }, correlationId: `${tag}-n2` }, depsFor(env).deps)).toMatchObject({ kind: "abstain", reason: "do_not_contact" });
      expect((await db.agentRun.findFirstOrThrow({ where: { correlationId: `${tag}-n2` } })).status).toBe("ABSTAINED");
    } finally {
      await db.agentSetting.deleteMany({ where: { agentKey: "wa_nudger" } });
    }
  });

  it("retention folds expired rows into daily aggregates, deletes them, and keeps the fresh ones", async () => {
    const { pruneAgentRuns } = await import("./retention");
    const { retentionStore } = await import("./retention-wiring");
    const old = new Date("2026-01-10T10:00:00Z");
    const mk = (n: number, retain: Date) => ({ createdAt: old, agentKey: "wa_nudger", purposeId: "nudger.draft", provider: "fake", model: "fake", promptId: "p", promptVersion: "1", inputClass: "none", inputTokens: 100, outputTokens: 10, costUsdEstimate: 0.5, latencyMs: 300, status: "OK" as const, correlationId: `${tag}-r${n}`, retainUntil: retain });
    await db.agentRunRollup.deleteMany({ where: { purposeId: "nudger.draft", day: new Date("2026-01-10") } });
    await db.agentRun.createMany({ data: [mk(1, new Date("2026-04-10")), mk(2, new Date("2026-04-10")), mk(3, new Date("2099-01-01"))] });
    const r = await pruneAgentRuns(retentionStore, new Date("2026-10-12T00:00:00Z"));
    expect(r.deleted).toBeGreaterThanOrEqual(2);
    expect(await db.agentRun.count({ where: { correlationId: { in: [`${tag}-r1`, `${tag}-r2`] } } })).toBe(0);
    expect(await db.agentRun.count({ where: { correlationId: `${tag}-r3` } })).toBe(1);
    const roll = await db.agentRunRollup.findFirstOrThrow({ where: { purposeId: "nudger.draft", agentKey: "wa_nudger", status: "OK", day: new Date("2026-01-10") } });
    expect(roll.runs).toBe(2);
    expect(Number(roll.costUsdEstimate)).toBeCloseTo(1, 6);
    expect(Number(roll.inputTokens)).toBe(200);
    const again = await pruneAgentRuns(retentionStore, new Date("2026-10-12T00:00:00Z"));
    expect(again.deleted).toBe(0);
    await db.agentRunRollup.deleteMany({ where: { purposeId: "nudger.draft", day: new Date("2026-01-10") } });
  });

  it("an autonomy raise needs a green gate, is audited with who and why, and is stored", async () => {
    const { setAutonomyLevel, EvalGateError } = await import("@/lib/agents/autonomy-service");
    const { autonomyDeps } = await import("@/lib/agents/autonomy-wiring");
    const admin = { id: adminId, role: "ADMIN" };
    const target = { agentKey: "wa_nudger", actionType: "draft_customer_message" };
    await expect(setAutonomyLevel({ ...autonomyDeps, evalGate: async () => ({ green: false, detail: "red" }) }, admin, { ...target, level: 4, reason: "ready" })).rejects.toBeInstanceOf(EvalGateError);
    expect(await db.agentAutonomy.count({ where: { agentKey: "wa_nudger" } })).toBe(0);
    const r = await setAutonomyLevel({ ...autonomyDeps, evalGate: async () => ({ green: true, detail: "ok" }) }, admin, { ...target, level: 4, reason: "approved sends" });
    expect(r).toEqual({ from: 3, to: 4, changed: true });
    expect((await db.agentAutonomy.findUniqueOrThrow({ where: { agentKey_actionType: { agentKey: "wa_nudger", actionType: "draft_customer_message" } } }))).toMatchObject({ level: 4, updatedById: adminId });
    const audit = await db.auditLog.findFirstOrThrow({ where: { entity: "AgentAutonomy", entityId: "wa_nudger:draft_customer_message" }, orderBy: { timestamp: "desc" } });
    expect(audit).toMatchObject({ action: "agent.autonomy.raise", userId: adminId, reason: "approved sends" });
    const down = await setAutonomyLevel(autonomyDeps, admin, { ...target, level: 3, reason: "pause" });
    expect(down).toEqual({ from: 4, to: 3, changed: true });
  });

  it("the real eval gate for the nudger is green on the shipped suite", async () => {
    const { agentEvalGate } = await import("@/lib/agents/evals/agent-gate");
    expect(await agentEvalGate("wa_nudger")).toMatchObject({ green: true });
    expect((await agentEvalGate("ai_summaries")).green).toBe(false);
  });
});
void vi;

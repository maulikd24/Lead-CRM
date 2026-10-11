/**
 * The pilot against a real database: the list, the sign-off, the encrypted key, the audit trail and the one access answer.
 * Skipped unless PILOT_DB_TEST=1 (and refuses any non-local database):
 *   PILOT_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch db> npx vitest run src/lib/agents/pilot-wiring.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ auth: async () => null }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.PILOT_DB_TEST === "1" && local;
const KEY = "sk-ant-api03-" + "z".repeat(40);

describe.skipIf(!enabled)("AI pilot against a real database", () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let w: typeof import("./pilot-wiring");
  let s: typeof import("./pilot-service");
  const since = new Date();
  let admin = "", admin2 = "", rm = "", rm2 = "", manager = "";

  beforeAll(async () => {
    vi.stubEnv("ENCRYPTION_KEY", "00".repeat(32));
    vi.stubEnv("WA_ASSIST_ENABLED", "1");
    ({ basePrisma: db } = await import("@/lib/db/prisma"));
    w = await import("./pilot-wiring");
    s = await import("./pilot-service");
    const mk = async (email: string, role: "ADMIN" | "RM" | "MANAGER") =>
      (await db.user.upsert({ where: { email }, update: { isActive: true, role }, create: { email, name: email.split("@")[0], role, passwordHash: "x" } })).id;
    admin = await mk("pilot-admin@example.test", "ADMIN");
    admin2 = await mk("pilot-admin2@example.test", "ADMIN");
    rm = await mk("pilot-rm1@example.test", "RM");
    rm2 = await mk("pilot-rm2@example.test", "RM");
    manager = await mk("pilot-mgr@example.test", "MANAGER");
    await db.aiPilotUser.deleteMany();
    await db.aiPilotSignoff.deleteMany();
    await db.integrationConfig.deleteMany({ where: { provider: "ai_provider" } });
    await db.agentSetting.deleteMany({ where: { agentKey: "wa_reply" } });
  });

  afterAll(async () => {
    await db.aiPilotUser.deleteMany();
    await db.aiPilotSignoff.deleteMany();
    await db.integrationConfig.deleteMany({ where: { provider: "ai_provider" } });
    await db.agentSetting.deleteMany({ where: { agentKey: "wa_reply" } });
    await db.user.deleteMany({ where: { email: { startsWith: "pilot-" } } }).catch(() => undefined); // audit rows may pin them: fine
    await db.$disconnect();
  });

  const A = () => ({ id: admin, role: "ADMIN" });
  const A2 = () => ({ id: admin2, role: "ADMIN" });
  const SIGN = async () => ({ confirmed: true, statementVersion: (await import("./pilot")).PILOT_STATEMENT_VERSION });

  it("starts closed for everyone", async () => {
    expect(await w.pilotAccessFor(rm)).toEqual({ allowed: false, reason: "agent_off" });
    await db.agentSetting.upsert({ where: { agentKey: "wa_reply" }, update: { enabled: true }, create: { agentKey: "wa_reply", enabled: true } });
    expect(await w.pilotAccessFor(rm)).toEqual({ allowed: false, reason: "no_ai_key" });
  });

  it("opens only for a listed user once the key and the sign-off are recorded, and every step is audited", async () => {
    expect((await s.saveAiKey(w.pilotDb, A(), KEY, w.encryptForStorage)).ok).toBe(true);
    expect(await w.pilotAccessFor(rm)).toEqual({ allowed: false, reason: "no_signoff" });
    // Four-eyes: the compliance signature alone does not open it, the same Admin cannot countersign, a different Admin does.
    expect((await s.recordSignoff(w.pilotDb, A(), await SIGN())).ok).toBe(true);
    expect(await w.pilotAccessFor(rm)).toEqual({ allowed: false, reason: "no_signoff" });
    expect(await s.recordSignoff(w.pilotDb, A(), await SIGN())).toMatchObject({ ok: false });
    expect(await db.aiPilotSignoff.count({ where: { revokedAt: null } })).toBe(1);
    expect((await s.recordSignoff(w.pilotDb, A2(), await SIGN())).ok).toBe(true);
    expect(await db.aiPilotSignoff.count({ where: { revokedAt: null } })).toBe(2);
    expect(await w.pilotAccessFor(rm)).toEqual({ allowed: false, reason: "not_in_pilot" });
    expect(await s.addPilotUser(w.pilotDb, A(), rm)).toEqual({ ok: true, changed: true });
    expect(await s.addPilotUser(w.pilotDb, A(), rm)).toEqual({ ok: true, changed: false });
    expect((await s.addPilotUser(w.pilotDb, A(), manager)).ok).toBe(false);
    expect(await w.pilotAccessFor(rm)).toEqual({ allowed: true });
    expect(await w.pilotAccessFor(rm2)).toEqual({ allowed: false, reason: "not_in_pilot" });
    expect(await w.pilotAccessFor(admin)).toEqual({ allowed: false, reason: "not_in_pilot" });

    const rows = await db.auditLog.findMany({ where: { entity: "AiPilot", userId: admin, timestamp: { gte: since } }, orderBy: { seq: "asc" } });
    expect(rows.map((r) => r.action)).toEqual(["ai_key_saved", "pilot_signoff_recorded", "pilot_user_added"]);
    expect(JSON.stringify(rows.map((r) => [r.action, r.oldValue, r.newValue, r.reason]))).not.toContain(KEY);
  });

  it("the key is stored encrypted, only its last four characters are readable, and a provider can be built from it", async () => {
    const row = await db.integrationConfig.findUniqueOrThrow({ where: { provider: "ai_provider" } });
    expect(JSON.stringify(row)).not.toContain(KEY);
    expect(String(row.credentials).split(":")).toHaveLength(3);
    const state = await s.loadPilotState(w.pilotDb);
    expect(state.aiKey?.last4).toBe("zzzz");
    expect(JSON.stringify(state)).not.toContain(KEY);
    expect((await w.pilotProvider())?.name).toBe("anthropic");
  });

  it("withdrawing the sign-off or removing the key closes it again at once", async () => {
    expect(await s.revokeSignoff(w.pilotDb, A())).toEqual({ ok: true, changed: true });
    expect(await w.pilotAccessFor(rm)).toEqual({ allowed: false, reason: "no_signoff" });
    expect(await db.aiPilotSignoff.count({ where: { revokedAt: null } })).toBe(0);
    expect(await s.recordSignoff(w.pilotDb, A(), await SIGN())).toEqual({ ok: true, changed: true });
    expect(await w.pilotAccessFor(rm)).toEqual({ allowed: false, reason: "no_signoff" });
    expect(await s.recordSignoff(w.pilotDb, A2(), await SIGN())).toEqual({ ok: true, changed: true });
    expect(await w.pilotAccessFor(rm)).toEqual({ allowed: true });
    expect(await s.removeAiKey(w.pilotDb, A())).toEqual({ ok: true, changed: true });
    expect(await w.pilotAccessFor(rm)).toEqual({ allowed: false, reason: "no_ai_key" });
    expect(await w.pilotProvider()).toBeNull();
    expect(await s.removePilotUser(w.pilotDb, A(), rm)).toEqual({ ok: true, changed: true });
  });
});

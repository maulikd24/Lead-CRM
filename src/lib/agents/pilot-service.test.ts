import { beforeEach, describe, expect, it } from "vitest";

import { PILOT_STATEMENT, PILOT_STATEMENT_VERSION } from "./pilot";
import { addPilotUser, loadPilotState, pilotAccess, recordSignoff, removeAiKey, removePilotUser, revokeSignoff, saveAiKey, type PilotDb } from "./pilot-service";

const ADMIN = { id: "ad1", role: "ADMIN" } as const;
const NOW = new Date("2026-10-11T10:00:00Z");

type Row = { userId: string; addedById: string; addedAt: Date };
function fakeDb(seed: { users?: Record<string, { name: string; role: string; isActive: boolean }>; list?: Row[]; agentOn?: boolean } = {}) {
  const state = {
    users: seed.users ?? { rm1: { name: "Ravi", role: "RM", isActive: true }, rm2: { name: "Rita", role: "RM", isActive: true }, mg1: { name: "Mohan", role: "MANAGER", isActive: true }, ad1: { name: "Asha", role: "ADMIN", isActive: true }, rmx: { name: "Gone", role: "RM", isActive: false }, dl1: { name: "Dev", role: "DEALER", isActive: true } },
    list: [...(seed.list ?? [])],
    signoffs: [] as { id: string; statementVersion: string; statement: string; acknowledgedById: string; acknowledgedAt: Date; revokedAt: Date | null; revokedById: string | null }[],
    key: null as null | { payload: string; last4: string; savedAt: Date; savedById: string },
    audit: [] as Record<string, unknown>[],
    agentOn: seed.agentOn ?? true,
  };
  const db: PilotDb = {
    agentOn: async () => state.agentOn,
    listPilotUsers: async () => state.list.map((r) => ({ ...r, name: state.users[r.userId]?.name ?? "(unknown)", role: state.users[r.userId]?.role ?? "?" })),
    findUser: async (id) => (state.users[id] ? { id, ...state.users[id] } : null),
    addPilotUser: async (userId, addedById, at) => { if (state.list.some((r) => r.userId === userId)) return false; state.list.push({ userId, addedById, addedAt: at }); return true; },
    removePilotUser: async (userId) => { const n = state.list.length; state.list = state.list.filter((r) => r.userId !== userId); return state.list.length < n; },
    isListed: async (userId) => state.list.some((r) => r.userId === userId),
    currentSignoff: async () => state.signoffs.filter((s) => !s.revokedAt).at(-1) ?? null,
    createSignoff: async (s) => { state.signoffs.push({ id: `so${state.signoffs.length + 1}`, ...s, revokedAt: null, revokedById: null }); },
    revokeSignoffs: async (byId, at) => { let n = 0; for (const s of state.signoffs) if (!s.revokedAt) { s.revokedAt = at; s.revokedById = byId; n++; } return n; },
    aiKeyMeta: async () => (state.key ? { last4: state.key.last4, savedAt: state.key.savedAt, savedById: state.key.savedById } : null),
    saveAiKey: async (payload, last4, byId, at) => { state.key = { payload, last4, savedAt: at, savedById: byId }; },
    deleteAiKey: async () => { const had = !!state.key; state.key = null; return had; },
    audit: async (e) => { state.audit.push(e); },
  };
  return { db, state };
}
const encrypt = (v: unknown) => `enc(${JSON.stringify(v)})`;
const KEY = "sk-ant-api03-" + "k".repeat(40);

let t: ReturnType<typeof fakeDb>;
beforeEach(() => { t = fakeDb(); });

describe("the list", () => {
  it("starts empty: nobody is in the pilot", async () => {
    expect((await loadPilotState(t.db)).users).toEqual([]);
  });

  it("an Admin adds an active RM; the change is audited with who and what", async () => {
    expect(await addPilotUser(t.db, ADMIN, "rm1", NOW)).toEqual({ ok: true, changed: true });
    expect((await loadPilotState(t.db)).users.map((u) => u.userId)).toEqual(["rm1"]);
    expect(t.state.audit).toEqual([expect.objectContaining({ userId: "ad1", entity: "AiPilot", entityId: "rm1", action: "pilot_user_added", newValue: expect.objectContaining({ name: "Ravi", role: "RM" }) })]);
  });

  it("adding the same person twice changes nothing and writes no second audit row", async () => {
    await addPilotUser(t.db, ADMIN, "rm1", NOW);
    expect(await addPilotUser(t.db, ADMIN, "rm1", NOW)).toEqual({ ok: true, changed: false });
    expect(t.state.audit).toHaveLength(1);
  });

  it.each([["mg1", "a Manager can only view the inbox, so cannot use the assistant"], ["dl1", "a Dealer has no inbox"], ["rmx", "an inactive user"], ["nobody", "an unknown id"]])("refuses %s (%s)", async (id) => {
    const r = await addPilotUser(t.db, ADMIN, id, NOW);
    expect(r.ok).toBe(false);
    expect((await loadPilotState(t.db)).users).toEqual([]);
    expect(t.state.audit).toEqual([]);
  });

  it("an Admin may put themselves on the list (they can reply on any customer)", async () => {
    expect(await addPilotUser(t.db, ADMIN, "ad1", NOW)).toEqual({ ok: true, changed: true });
  });

  it("removing takes effect at once and is audited; removing someone not listed is a quiet no-op", async () => {
    await addPilotUser(t.db, ADMIN, "rm1", NOW);
    expect(await removePilotUser(t.db, ADMIN, "rm1", NOW)).toEqual({ ok: true, changed: true });
    expect(await pilotAccess(t.db, "rm1")).toMatchObject({ allowed: false });
    expect(t.state.audit.map((a) => a.action)).toEqual(["pilot_user_added", "pilot_user_removed"]);
    expect(await removePilotUser(t.db, ADMIN, "rm1", NOW)).toEqual({ ok: true, changed: false });
    expect(t.state.audit).toHaveLength(2);
  });

  it.each([["RM"], ["MANAGER"], ["DEALER"], ["FINANCE"], ["PARTNER"]])("a %s cannot change the list, the sign-off or the key", async (role) => {
    const who = { id: "x", role } as never;
    expect((await addPilotUser(t.db, who, "rm1", NOW)).ok).toBe(false);
    expect((await removePilotUser(t.db, who, "rm1", NOW)).ok).toBe(false);
    expect((await recordSignoff(t.db, who, { confirmed: true, statementVersion: PILOT_STATEMENT_VERSION }, NOW)).ok).toBe(false);
    expect((await revokeSignoff(t.db, who, NOW)).ok).toBe(false);
    expect((await saveAiKey(t.db, who, KEY, encrypt, NOW)).ok).toBe(false);
    expect((await removeAiKey(t.db, who, NOW)).ok).toBe(false);
    expect(t.state.audit).toEqual([]);
    expect(t.state.signoffs).toEqual([]);
    expect(t.state.key).toBeNull();
  });
});

describe("the sign-off", () => {
  it("records who and when, with the exact wording that was on the screen", async () => {
    expect(await recordSignoff(t.db, ADMIN, { confirmed: true, statementVersion: PILOT_STATEMENT_VERSION }, NOW)).toEqual({ ok: true, changed: true });
    expect(t.state.signoffs[0]).toMatchObject({ acknowledgedById: "ad1", acknowledgedAt: NOW, statementVersion: PILOT_STATEMENT_VERSION, statement: PILOT_STATEMENT.join("\n") });
    expect(t.state.audit[0]).toMatchObject({ action: "pilot_signoff_recorded", entityId: "signoff" });
    expect((await loadPilotState(t.db)).signoff).toMatchObject({ acknowledgedById: "ad1", acknowledgedByName: "Asha", acknowledgedAt: NOW });
  });
  it("needs the box ticked", async () => {
    expect((await recordSignoff(t.db, ADMIN, { confirmed: false, statementVersion: PILOT_STATEMENT_VERSION }, NOW)).ok).toBe(false);
    expect(t.state.signoffs).toEqual([]);
  });
  it("signing twice on the same wording keeps the first record", async () => {
    await recordSignoff(t.db, ADMIN, { confirmed: true, statementVersion: PILOT_STATEMENT_VERSION }, NOW);
    expect(await recordSignoff(t.db, ADMIN, { confirmed: true, statementVersion: PILOT_STATEMENT_VERSION }, new Date(NOW.getTime() + 1000))).toEqual({ ok: true, changed: false });
    expect(t.state.signoffs).toHaveLength(1);
  });
  it("revoking switches the pilot off again and is audited", async () => {
    await recordSignoff(t.db, ADMIN, { confirmed: true, statementVersion: PILOT_STATEMENT_VERSION }, NOW);
    expect(await revokeSignoff(t.db, ADMIN, NOW)).toEqual({ ok: true, changed: true });
    expect((await loadPilotState(t.db)).signoff).toBeNull();
    expect(t.state.audit.at(-1)).toMatchObject({ action: "pilot_signoff_revoked" });
    expect(await revokeSignoff(t.db, ADMIN, NOW)).toEqual({ ok: true, changed: false });
  });
});

describe("the AI key", () => {
  it("is stored encrypted; the audit row and the state carry only its last four characters", async () => {
    expect(await saveAiKey(t.db, ADMIN, `  ${KEY} `, encrypt, NOW)).toEqual({ ok: true, changed: true });
    expect(t.state.key?.payload).toBe(encrypt({ apiKey: KEY }));
    expect(t.state.key?.last4).toBe("kkkk");
    const everything = JSON.stringify([t.state.audit, await loadPilotState(t.db)]);
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain("sk-ant");
    expect(t.state.audit[0]).toMatchObject({ action: "ai_key_saved", entityId: "ai_key", newValue: { last4: "kkkk" } });
  });
  it("refuses something that is not a key without storing or echoing it", async () => {
    const r = await saveAiKey(t.db, ADMIN, "not a key at all, really not", encrypt, NOW);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("not a key at all");
    expect(t.state.key).toBeNull();
  });
  it("replacing the key is audited as a replacement; removing it switches the pilot off again", async () => {
    await saveAiKey(t.db, ADMIN, KEY, encrypt, NOW);
    await saveAiKey(t.db, ADMIN, KEY.replace(/k{4}$/, "zzzz"), encrypt, NOW);
    expect(t.state.audit.map((a) => a.action)).toEqual(["ai_key_saved", "ai_key_replaced"]);
    expect(await removeAiKey(t.db, ADMIN, NOW)).toEqual({ ok: true, changed: true });
    expect((await loadPilotState(t.db)).aiKey).toBeNull();
    expect(t.state.audit.at(-1)).toMatchObject({ action: "ai_key_removed" });
  });
});

describe("pilotAccess: the one answer the assistant asks", () => {
  async function fullyReady() {
    await saveAiKey(t.db, ADMIN, KEY, encrypt, NOW);
    await recordSignoff(t.db, ADMIN, { confirmed: true, statementVersion: PILOT_STATEMENT_VERSION }, NOW);
    await addPilotUser(t.db, ADMIN, "rm1", NOW);
  }
  it("is closed for everyone while the list is empty, even with the key and sign-off in place", async () => {
    await saveAiKey(t.db, ADMIN, KEY, encrypt, NOW);
    await recordSignoff(t.db, ADMIN, { confirmed: true, statementVersion: PILOT_STATEMENT_VERSION }, NOW);
    for (const id of ["rm1", "rm2", "ad1", "mg1"]) expect(await pilotAccess(t.db, id)).toEqual({ allowed: false, reason: "not_in_pilot" });
  });
  it("opens for a listed user and only for them", async () => {
    await fullyReady();
    expect(await pilotAccess(t.db, "rm1")).toEqual({ allowed: true });
    expect(await pilotAccess(t.db, "rm2")).toEqual({ allowed: false, reason: "not_in_pilot" });
  });
  it("stays closed without the key, without the sign-off, or with the agent off, even for a listed user", async () => {
    await fullyReady();
    await removeAiKey(t.db, ADMIN, NOW);
    expect(await pilotAccess(t.db, "rm1")).toEqual({ allowed: false, reason: "no_ai_key" });
    await saveAiKey(t.db, ADMIN, KEY, encrypt, NOW);
    await revokeSignoff(t.db, ADMIN, NOW);
    expect(await pilotAccess(t.db, "rm1")).toEqual({ allowed: false, reason: "no_signoff" });
    await recordSignoff(t.db, ADMIN, { confirmed: true, statementVersion: PILOT_STATEMENT_VERSION }, NOW);
    t.state.agentOn = false;
    expect(await pilotAccess(t.db, "rm1")).toEqual({ allowed: false, reason: "agent_off" });
  });
  it("does not look at the list when a prerequisite is already missing", async () => {
    let listed = 0;
    const db = { ...t.db, isListed: async () => { listed++; return true; } };
    expect(await pilotAccess(db, "rm1")).toMatchObject({ allowed: false });
    expect(listed).toBe(0);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";
import { PILOT_STATEMENT_VERSION } from "@/lib/agents/pilot";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());

const db = vi.hoisted(() => ({
  agentOn: vi.fn(), listPilotUsers: vi.fn(), findUser: vi.fn(), addPilotUser: vi.fn(), removePilotUser: vi.fn(), isListed: vi.fn(),
  currentSignoff: vi.fn(), createSignoff: vi.fn(), revokeSignoffs: vi.fn(), aiKeyMeta: vi.fn(), saveAiKey: vi.fn(), deleteAiKey: vi.fn(), audit: vi.fn(),
}));
vi.mock("@/lib/agents/pilot-wiring", () => ({ pilotDb: db, encryptForStorage: (v: unknown) => `enc:${JSON.stringify(v)}` }));

import { addPilotUserAction, recordSignoffAction, removeAiKeyAction, removePilotUserAction, revokeSignoffAction, saveAiKeyAction } from "./actions";

const KEY = "sk-ant-api03-" + "q".repeat(40);
const ALL_ROLES = ["ADMIN", "MANAGER", "RM", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "FINANCE"] as const;
const calls = {
  addPilotUserAction: () => addPilotUserAction("rm1"),
  removePilotUserAction: () => removePilotUserAction("rm1"),
  recordSignoffAction: () => recordSignoffAction({ confirmed: true, statementVersion: PILOT_STATEMENT_VERSION }),
  revokeSignoffAction: () => revokeSignoffAction(),
  saveAiKeyAction: () => saveAiKeyAction(KEY),
  removeAiKeyAction: () => removeAiKeyAction(),
};

beforeEach(() => {
  resetSession();
  vi.clearAllMocks();
  db.findUser.mockResolvedValue({ id: "rm1", name: "Ravi", role: "RM", isActive: true });
  db.addPilotUser.mockResolvedValue(true);
  db.removePilotUser.mockResolvedValue(true);
  db.currentSignoff.mockResolvedValue(null);
  db.revokeSignoffs.mockResolvedValue(1);
  db.aiKeyMeta.mockResolvedValue(null);
  db.deleteAiKey.mockResolvedValue(true);
});

describe.each(Object.entries(calls))("%s", (_name, call) => {
  it.each(ALL_ROLES)("%s: only an Admin gets through; nobody else touches the data", async (role) => {
    asUser({ role });
    const r = await outcomeOf(() => call() as Promise<unknown>);
    expect(r.kind === "redirect").toBe(role !== "ADMIN");
    if (role !== "ADMIN") for (const f of Object.values(db)) expect(f).not.toHaveBeenCalled();
  });
  it("sends a signed-out visitor to the login page", async () => {
    asAnonymous();
    expect(await outcomeOf(() => call() as Promise<unknown>)).toEqual({ kind: "redirect", url: "/login" });
    for (const f of Object.values(db)) expect(f).not.toHaveBeenCalled();
  });
});

describe("as an Admin", () => {
  it("adds a person and writes an audit row naming the Admin", async () => {
    const admin = asUser({ role: "ADMIN" });
    expect(await addPilotUserAction("rm1")).toEqual({ ok: true, changed: true });
    expect(db.addPilotUser).toHaveBeenCalledWith("rm1", admin.id, expect.any(Date));
    expect(db.audit).toHaveBeenCalledWith(expect.objectContaining({ userId: admin.id, action: "pilot_user_added", entityId: "rm1" }));
  });
  it("records the sign-off as this Admin, now", async () => {
    const admin = asUser({ role: "ADMIN" });
    await recordSignoffAction({ confirmed: true, statementVersion: PILOT_STATEMENT_VERSION });
    expect(db.createSignoff).toHaveBeenCalledWith(expect.objectContaining({ acknowledgedById: admin.id, statementVersion: PILOT_STATEMENT_VERSION, acknowledgedAt: expect.any(Date) }));
  });
  it("refuses a sign-off without the tick", async () => {
    asUser({ role: "ADMIN" });
    expect((await recordSignoffAction({ confirmed: false, statementVersion: PILOT_STATEMENT_VERSION })).ok).toBe(false);
    expect(db.createSignoff).not.toHaveBeenCalled();
  });
  it("stores the key encrypted and returns nothing that contains it", async () => {
    asUser({ role: "ADMIN" });
    const r = await saveAiKeyAction(KEY);
    expect(r).toEqual({ ok: true, changed: true });
    expect(db.saveAiKey).toHaveBeenCalledWith(`enc:${JSON.stringify({ apiKey: KEY })}`, "qqqq", expect.any(String), expect.any(Date));
    expect(JSON.stringify([r, db.audit.mock.calls])).not.toContain(KEY);
  });
});

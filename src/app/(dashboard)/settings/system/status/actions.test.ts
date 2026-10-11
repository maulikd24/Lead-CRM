import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());

const tick = vi.hoisted(() => ({ upsert: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/system/status-wiring", () => ({ tickDb: tick, statusDeps: {} }));

import { setCutoverTickAction } from "./actions";

const ALL_ROLES = ["ADMIN", "MANAGER", "RM", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "FINANCE"] as const;

beforeEach(() => { resetSession(); vi.clearAllMocks(); });

describe("setCutoverTickAction", () => {
  it.each(ALL_ROLES)("%s: only an Admin may tick a check", async (role) => {
    asUser({ role });
    const r = await outcomeOf(() => setCutoverTickAction("login-admin", true, "ok"));
    expect(r.kind === "redirect").toBe(role !== "ADMIN");
    if (role !== "ADMIN") { expect(tick.upsert).not.toHaveBeenCalled(); expect(tick.audit).not.toHaveBeenCalled(); }
  });
  it("sends a signed-out visitor to the login page", async () => {
    asAnonymous();
    expect(await outcomeOf(() => setCutoverTickAction("login-admin", true, null))).toEqual({ kind: "redirect", url: "/login" });
    expect(tick.upsert).not.toHaveBeenCalled();
  });
  it("records the Admin who ticked it", async () => {
    const admin = asUser({ role: "ADMIN" });
    expect(await setCutoverTickAction("login-admin", true, "checked on a laptop")).toEqual({ ok: true });
    expect(tick.upsert).toHaveBeenCalledWith("cutover:login-admin", expect.objectContaining({ done: true, doneById: admin.id, note: "checked on a laptop" }));
    expect(tick.audit).toHaveBeenCalledWith(expect.objectContaining({ userId: admin.id, entityId: "login-admin" }));
  });
  it("refuses an automatic or unknown check", async () => {
    asUser({ role: "ADMIN" });
    expect((await setCutoverTickAction("db-connected", true, null)).ok).toBe(false);
    expect((await setCutoverTickAction("nope", true, null)).ok).toBe(false);
    expect(tick.upsert).not.toHaveBeenCalled();
  });
});

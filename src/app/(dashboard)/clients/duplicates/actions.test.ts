import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/stage-engine/next-action", () => ({ syncNextAction: vi.fn(async () => undefined) }));

// The decision logic is real; only the data layer behind it is faked.
const deps = vi.hoisted(() => {
  const state = { visible: null as string[] | null, suggestion: { id: "s1", status: "OPEN", clientAId: "a", clientBId: "b" } as { id: string; status: string; clientAId: string; clientBId: string } | null, scopes: [{ id: "a", assignedToId: "rm-1" }, { id: "b", assignedToId: "rm-1" }] as { id: string; assignedToId: string | null }[], rateOk: true };
  const merge = vi.fn();
  const dismiss = vi.fn();
  const logAccess = vi.fn();
  const readField = vi.fn();
  const decideDeps = () => ({
    visibleUserIds: async () => state.visible,
    loadSuggestion: async () => state.suggestion,
    loadClientScopes: async () => state.scopes,
    allowRate: async () => state.rateOk,
    merge,
    dismiss,
  });
  const revealDeps = () => ({ visibleUserIds: async () => state.visible, loadSuggestion: async () => state.suggestion, loadClientScopes: async () => state.scopes, allowRate: async () => state.rateOk, logAccess, readField });
  return { state, merge, dismiss, logAccess, readField, decideDeps, revealDeps };
});
vi.mock("@/lib/identity/merge-review/wiring", () => ({ decideDeps: deps.decideDeps, revealDeps: deps.revealDeps }));
const load = vi.hoisted(() => ({ loadComparison: vi.fn() }));
vi.mock("@/lib/identity/merge-review/load", () => load);

import { dismissSuggestionAction, getComparisonAction, mergeSuggestionAction, revealFieldAction } from "./actions";

const ROLES_OUT = ["RM", "DEALER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "TEAM_MANAGER", "FINANCE"] as const;
const actions: [string, () => Promise<unknown>][] = [
  ["merge", () => mergeSuggestionAction("s1", "a", true) as Promise<unknown>],
  ["dismiss", () => dismissSuggestionAction("s1", "not the same person") as Promise<unknown>],
  ["reveal", () => revealFieldAction("s1", "a", "mobile") as Promise<unknown>],
];

beforeEach(() => {
  resetSession();
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_MERGE_REVIEW", "1");
  deps.state.visible = null;
  deps.state.suggestion = { id: "s1", status: "OPEN", clientAId: "a", clientBId: "b" };
  deps.state.scopes = [{ id: "a", assignedToId: "rm-1" }, { id: "b", assignedToId: "rm-1" }];
  deps.state.rateOk = true;
  deps.merge.mockResolvedValue({ conflicts: [] });
  deps.dismiss.mockResolvedValue(true);
  deps.readField.mockResolvedValue("9999999999");
  load.loadComparison.mockResolvedValue({ ok: true });
});

describe.each(actions)("duplicate review action: %s", (_n, run) => {
  it("sends a signed-out caller to /login", async () => {
    asAnonymous();
    expect(await outcomeOf(run)).toEqual({ kind: "redirect", url: "/login" });
    expect(deps.merge).not.toHaveBeenCalled();
    expect(deps.dismiss).not.toHaveBeenCalled();
    expect(deps.logAccess).not.toHaveBeenCalled();
  });
  it("is refused while the flag is off, even for an admin, and does nothing", async () => {
    vi.stubEnv("NEXT_PUBLIC_MERGE_REVIEW", "");
    asUser({ role: "ADMIN" });
    const r = await outcomeOf(run);
    expect(r.kind === "returned" && (r.value as { ok: boolean }).ok).toBe(false);
    expect(deps.merge).not.toHaveBeenCalled();
    expect(deps.dismiss).not.toHaveBeenCalled();
    expect(deps.logAccess).not.toHaveBeenCalled();
    expect(load.loadComparison).not.toHaveBeenCalled();
  });
  it.each(ROLES_OUT)("refuses the %s role", async (role) => {
    asUser({ role });
    const r = await outcomeOf(run);
    expect(r.kind === "returned" && (r.value as { ok: boolean }).ok).toBe(false);
    expect(deps.merge).not.toHaveBeenCalled();
    expect(deps.dismiss).not.toHaveBeenCalled();
    expect(deps.logAccess).not.toHaveBeenCalled();
  });
});

describe("getComparisonAction", () => {
  it("sends a signed-out caller to /login and is refused while the flag is off", async () => {
    asAnonymous();
    expect(await outcomeOf(() => getComparisonAction("s1"))).toEqual({ kind: "redirect", url: "/login" });
    vi.stubEnv("NEXT_PUBLIC_MERGE_REVIEW", "");
    asUser({ role: "ADMIN" });
    expect(await outcomeOf(() => getComparisonAction("s1"))).toMatchObject({ value: { ok: false } });
    expect(load.loadComparison).not.toHaveBeenCalled();
  });
  it("passes the session user, never a client-supplied one, to the loader", async () => {
    const mgr = asUser({ role: "MANAGER" });
    await getComparisonAction("s1");
    expect(load.loadComparison).toHaveBeenCalledWith({ id: mgr.id, role: "MANAGER" }, "s1");
  });
  it("the real loader refuses every role except admin and manager before reading anything", async () => {
    const real = await vi.importActual<typeof import("@/lib/identity/merge-review/load")>("@/lib/identity/merge-review/load");
    for (const role of ROLES_OUT) {
      expect(await real.loadComparison({ id: "u", role }, "s1")).toMatchObject({ ok: false });
    }
  });
});

describe("mergeSuggestionAction", () => {
  it("requires the explicit confirmation to be literally true", async () => {
    asUser({ role: "ADMIN" });
    for (const confirmed of [false, "true", 1, undefined, null]) {
      const r = await outcomeOf(() => mergeSuggestionAction("s1", "a", confirmed));
      expect(r).toMatchObject({ kind: "returned", value: { ok: false, code: "INVALID" } });
    }
    expect(deps.merge).not.toHaveBeenCalled();
  });
  it("only lets the survivor be one of the two customers in the suggestion", async () => {
    asUser({ role: "ADMIN" });
    expect(await outcomeOf(() => mergeSuggestionAction("s1", "zzz", true))).toMatchObject({ value: { ok: false, code: "INVALID" } });
    expect(deps.merge).not.toHaveBeenCalled();
  });
  it("merges for an admin, using the session id as the actor", async () => {
    const admin = asUser({ role: "ADMIN" });
    const r = await outcomeOf(() => mergeSuggestionAction("s1", "a", true));
    expect(r).toMatchObject({ kind: "returned", value: { ok: true, survivorId: "a" } });
    expect(deps.merge).toHaveBeenCalledWith({ suggestionId: "s1", survivorId: "a", duplicateId: "b", actorId: admin.id });
  });
  it("lets a manager merge two customers in their scope", async () => {
    deps.state.visible = ["mgr-1", "rm-1"];
    asUser({ id: "mgr-1", role: "MANAGER" });
    expect(await outcomeOf(() => mergeSuggestionAction("s1", "b", true))).toMatchObject({ value: { ok: true } });
  });
  it("lets a manager merge a pair that spans two teams (owner decision: managers may merge any two)", async () => {
    deps.state.visible = ["mgr-1", "rm-1"];
    deps.state.scopes = [{ id: "a", assignedToId: "rm-1" }, { id: "b", assignedToId: "rm-9" }];
    asUser({ id: "mgr-1", role: "MANAGER" });
    expect(await outcomeOf(() => mergeSuggestionAction("s1", "a", true))).toMatchObject({ value: { ok: true } });
    expect(deps.merge).toHaveBeenCalledTimes(1);
  });
  it("lets a manager merge an unassigned pair (they own the pool)", async () => {
    deps.state.visible = ["mgr-1"];
    deps.state.scopes = [{ id: "a", assignedToId: null }, { id: "b", assignedToId: null }];
    asUser({ id: "mgr-1", role: "MANAGER" });
    expect(await outcomeOf(() => mergeSuggestionAction("s1", "a", true))).toMatchObject({ value: { ok: true } });
  });
  it("does not act on a suggestion somebody else already decided", async () => {
    deps.state.suggestion = { id: "s1", status: "MERGED", clientAId: "a", clientBId: "b" };
    asUser({ role: "ADMIN" });
    expect(await outcomeOf(() => mergeSuggestionAction("s1", "a", true))).toMatchObject({ value: { ok: false, code: "STALE" } });
    expect(deps.merge).not.toHaveBeenCalled();
  });
  it("is rate limited per reviewer", async () => {
    deps.state.rateOk = false;
    asUser({ role: "ADMIN" });
    expect(await outcomeOf(() => mergeSuggestionAction("s1", "a", true))).toMatchObject({ value: { ok: false, code: "RATE_LIMITED" } });
    expect(deps.merge).not.toHaveBeenCalled();
  });
});

describe("dismissSuggestionAction and revealFieldAction", () => {
  it("dismisses for a manager whatever team the pair belongs to, and for an admin", async () => {
    deps.state.visible = ["mgr-1"];
    deps.state.scopes = [{ id: "a", assignedToId: "rm-9" }, { id: "b", assignedToId: "rm-9" }];
    asUser({ id: "mgr-1", role: "MANAGER" });
    expect(await outcomeOf(() => dismissSuggestionAction("s1"))).toMatchObject({ value: { ok: true } });
    expect(deps.dismiss).toHaveBeenCalledTimes(1);
    deps.state.visible = null;
    asUser({ role: "ADMIN" });
    expect(await outcomeOf(() => dismissSuggestionAction("s1"))).toMatchObject({ value: { ok: true } });
  });
  it("logs a reveal before returning the value, with the session user, for a manager too", async () => {
    const admin = asUser({ role: "ADMIN" });
    const order: string[] = [];
    deps.logAccess.mockImplementation(async () => void order.push("log"));
    deps.readField.mockImplementation(async () => (order.push("read"), "9999999999"));
    expect(await outcomeOf(() => revealFieldAction("s1", "b", "mobile"))).toMatchObject({ value: { ok: true, value: "9999999999" } });
    expect(order).toEqual(["log", "read"]);
    expect(deps.logAccess).toHaveBeenCalledWith({ userId: admin.id, clientId: "b", field: "mobile" });

    deps.state.visible = ["mgr-1"];
    deps.state.scopes = [{ id: "a", assignedToId: "rm-9" }, { id: "b", assignedToId: "rm-9" }];
    asUser({ id: "mgr-1", role: "MANAGER" });
    vi.clearAllMocks();
    expect(await outcomeOf(() => revealFieldAction("s1", "a", "pan"))).toMatchObject({ value: { ok: true } });
    expect(deps.logAccess).toHaveBeenCalledWith({ userId: "mgr-1", clientId: "a", field: "pan" });
  });
  it("only reveals mobile, email or PAN", async () => {
    asUser({ role: "ADMIN" });
    expect(await outcomeOf(() => revealFieldAction("s1", "a", "passwordHash"))).toMatchObject({ value: { ok: false, code: "INVALID" } });
    expect(deps.readField).not.toHaveBeenCalled();
  });
});

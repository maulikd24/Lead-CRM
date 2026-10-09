import { describe, expect, it, vi } from "vitest";
import { MergeBlockedError } from "@/lib/clients/merge";
import { decideDismiss, decideMerge, decideReveal, inScope, type DecideDeps, type RevealDeps } from "./decide";

const suggestion = { id: "s1", status: "OPEN", clientAId: "a", clientBId: "b" };
const deps = (over: Partial<DecideDeps> = {}): DecideDeps => ({
  visibleUserIds: vi.fn(async () => null),
  loadSuggestion: vi.fn(async () => suggestion),
  loadClientScopes: vi.fn(async () => [
    { id: "a", assignedToId: "u1" },
    { id: "b", assignedToId: "u2" },
  ]),
  allowRate: vi.fn(async () => true),
  merge: vi.fn(async () => ({ duplicateId: "b", duplicateName: "B", conflicts: [] })),
  dismiss: vi.fn(async () => true),
  ...over,
});
const admin = { id: "admin", role: "ADMIN" as const };
const manager = { id: "m1", role: "MANAGER" as const };
const input = { suggestionId: "s1", survivorId: "a", confirmed: true };

describe("inScope", () => {
  it("admin sees everything, rm only own, manager also unassigned", () => {
    expect(inScope(null, "ADMIN", "x")).toBe(true);
    expect(inScope(["m1", "u1"], "MANAGER", "u1")).toBe(true);
    expect(inScope(["m1", "u1"], "MANAGER", "u9")).toBe(false);
    expect(inScope(["m1"], "MANAGER", null)).toBe(true);
    expect(inScope(["rm"], "RM", null)).toBe(false);
  });
});

describe("decideMerge", () => {
  it("merges for an admin and passes survivor/duplicate correctly", async () => {
    const d = deps();
    const r = await decideMerge(d, admin, input);
    expect(r).toMatchObject({ ok: true, survivorId: "a", duplicateId: "b" });
    expect(d.merge).toHaveBeenCalledWith({ suggestionId: "s1", survivorId: "a", duplicateId: "b", actorId: "admin" });
  });
  it("treats the other client as the survivor when asked", async () => {
    const d = deps();
    await decideMerge(d, admin, { ...input, survivorId: "b" });
    expect(d.merge).toHaveBeenCalledWith(expect.objectContaining({ survivorId: "b", duplicateId: "a" }));
  });
  it.each(["RM", "DEALER", "FINANCE", "PARTNER"] as const)("refuses role %s before touching anything", async (role) => {
    const d = deps();
    const r = await decideMerge(d, { id: "x", role }, input);
    expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(d.loadSuggestion).not.toHaveBeenCalled();
    expect(d.merge).not.toHaveBeenCalled();
  });
  it("requires explicit confirmation", async () => {
    const d = deps();
    expect(await decideMerge(d, admin, { ...input, confirmed: false })).toMatchObject({ ok: false, code: "INVALID" });
    expect(await decideMerge(d, admin, { ...input, confirmed: undefined as unknown as boolean })).toMatchObject({ ok: false, code: "INVALID" });
    expect(d.merge).not.toHaveBeenCalled();
  });
  it("rejects a survivor that is not part of the suggestion", async () => {
    const d = deps();
    expect(await decideMerge(d, admin, { ...input, survivorId: "zzz" })).toMatchObject({ ok: false, code: "INVALID" });
    expect(d.merge).not.toHaveBeenCalled();
  });
  it("rejects malformed ids", async () => {
    const d = deps();
    expect(await decideMerge(d, admin, { suggestionId: 5 as unknown as string, survivorId: "a", confirmed: true })).toMatchObject({ ok: false, code: "INVALID" });
  });
  it("is rate limited", async () => {
    const d = deps({ allowRate: vi.fn(async () => false) });
    expect(await decideMerge(d, admin, input)).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(d.merge).not.toHaveBeenCalled();
  });
  it("reports a missing or already decided suggestion", async () => {
    expect(await decideMerge(deps({ loadSuggestion: vi.fn(async () => null) }), admin, input)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await decideMerge(deps({ loadSuggestion: vi.fn(async () => ({ ...suggestion, status: "MERGED" })) }), admin, input)).toMatchObject({ ok: false, code: "STALE" });
  });
  it("a manager needs visibility over BOTH customers", async () => {
    const d = deps({ visibleUserIds: vi.fn(async () => ["m1", "u1"]) });
    const r = await decideMerge(d, manager, input);
    expect(r).toMatchObject({ ok: false, code: "OUT_OF_SCOPE" });
    expect(d.merge).not.toHaveBeenCalled();
    const ok = await decideMerge(deps({ visibleUserIds: vi.fn(async () => ["m1", "u1", "u2"]) }), manager, input);
    expect(ok.ok).toBe(true);
  });
  it("an archived or missing customer makes the suggestion stale", async () => {
    const d = deps({ loadClientScopes: vi.fn(async () => [{ id: "a", assignedToId: "u1" }]) });
    expect(await decideMerge(d, admin, input)).toMatchObject({ ok: false, code: "STALE" });
  });
  it("maps the transaction's compare-and-set / PAN refusals to a clean result", async () => {
    const d = deps({ merge: vi.fn(async () => { throw new MergeBlockedError("different PAN numbers", "PAN_MISMATCH"); }) });
    expect(await decideMerge(d, admin, input)).toEqual({ ok: false, code: "BLOCKED", error: "different PAN numbers" });
    const stale = deps({ merge: vi.fn(async () => { throw new MergeBlockedError("already merged", "STALE"); }) });
    expect(await decideMerge(stale, admin, input)).toMatchObject({ ok: false, code: "STALE" });
  });
  it("does not leak unexpected errors", async () => {
    const d = deps({ merge: vi.fn(async () => { throw new Error("connection string postgres://secret"); }) });
    const r = await decideMerge(d, admin, input);
    expect(r).toMatchObject({ ok: false, code: "ERROR" });
    expect(JSON.stringify(r)).not.toContain("secret");
  });
});

describe("decideDismiss", () => {
  it("dismisses with an optional trimmed reason", async () => {
    const d = deps();
    expect(await decideDismiss(d, manager, { suggestionId: "s1", reason: "  family members  " }).catch(() => null)).toBeTruthy();
  });
  it("passes the reason through and handles a lost race", async () => {
    const d = deps({ visibleUserIds: vi.fn(async () => null) });
    await decideDismiss(d, admin, { suggestionId: "s1", reason: "  twins  " });
    expect(d.dismiss).toHaveBeenCalledWith({ suggestionId: "s1", actorId: "admin", reason: "twins" });
    const lost = deps({ dismiss: vi.fn(async () => false) });
    expect(await decideDismiss(lost, admin, { suggestionId: "s1" })).toMatchObject({ ok: false, code: "STALE" });
  });
  it("is limited to ADMIN/MANAGER, in-scope, rate limited and bounded", async () => {
    expect(await decideDismiss(deps(), { id: "r", role: "RM" }, { suggestionId: "s1" })).toMatchObject({ code: "FORBIDDEN" });
    expect(await decideDismiss(deps({ visibleUserIds: vi.fn(async () => ["m1"]) }), manager, { suggestionId: "s1" })).toMatchObject({ code: "OUT_OF_SCOPE" });
    expect(await decideDismiss(deps({ allowRate: vi.fn(async () => false) }), admin, { suggestionId: "s1" })).toMatchObject({ code: "RATE_LIMITED" });
    expect(await decideDismiss(deps(), admin, { suggestionId: "s1", reason: "x".repeat(301) })).toMatchObject({ code: "INVALID" });
  });
});

describe("rate-limit kinds", () => {
  it("merge and dismiss are limited separately", async () => {
    const d = deps();
    await decideMerge(d, admin, input);
    await decideDismiss(d, admin, { suggestionId: "s1" });
    expect(d.allowRate).toHaveBeenNthCalledWith(1, "admin", "merge");
    expect(d.allowRate).toHaveBeenNthCalledWith(2, "admin", "dismiss");
  });
});

describe("decideReveal", () => {
  const rdeps = (over: Partial<RevealDeps> = {}): RevealDeps => ({
    ...deps(),
    readField: vi.fn(async () => "9876543210"),
    logAccess: vi.fn(async () => {}),
    ...over,
  });
  it("logs the access first, then returns the raw value", async () => {
    const order: string[] = [];
    const d = rdeps({ logAccess: vi.fn(async () => { order.push("log"); }), readField: vi.fn(async () => { order.push("read"); return "9876543210"; }) });
    expect(await decideReveal(d, admin, { suggestionId: "s1", side: "b", field: "mobile" })).toEqual({ ok: true, value: "9876543210" });
    expect(order).toEqual(["log", "read"]);
    expect(d.logAccess).toHaveBeenCalledWith({ userId: "admin", clientId: "b", field: "mobile" });
  });
  it("refuses RMs, unknown fields, out-of-scope managers and decided suggestions without reading", async () => {
    const d = rdeps({ visibleUserIds: vi.fn(async () => ["m1"]) });
    expect(await decideReveal(rdeps(), { id: "r", role: "RM" }, { suggestionId: "s1", side: "a", field: "pan" })).toMatchObject({ code: "FORBIDDEN" });
    expect(await decideReveal(rdeps(), admin, { suggestionId: "s1", side: "a", field: "passwordHash" })).toMatchObject({ code: "INVALID" });
    expect(await decideReveal(rdeps(), admin, { suggestionId: "s1", side: "c", field: "pan" })).toMatchObject({ code: "INVALID" });
    expect(await decideReveal(d, manager, { suggestionId: "s1", side: "a", field: "pan" })).toMatchObject({ code: "OUT_OF_SCOPE" });
    const decided = rdeps({ loadSuggestion: vi.fn(async () => ({ ...suggestion, status: "DISMISSED" })) });
    expect(await decideReveal(decided, admin, { suggestionId: "s1", side: "a", field: "pan" })).toMatchObject({ code: "STALE" });
    expect(d.readField).not.toHaveBeenCalled();
  });
  it("does not reveal when the access log cannot be written", async () => {
    const d = rdeps({ logAccess: vi.fn(async () => { throw new Error("db"); }) });
    expect(await decideReveal(d, admin, { suggestionId: "s1", side: "a", field: "email" })).toMatchObject({ ok: false, code: "ERROR" });
    expect(d.readField).not.toHaveBeenCalled();
  });
});

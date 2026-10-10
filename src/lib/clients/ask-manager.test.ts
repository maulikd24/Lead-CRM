import { describe, expect, it, vi } from "vitest";

import { askManagerToReview, type AskDeps } from "./ask-manager";
import { mayMerge, needsManagerReview } from "./merge-policy";

const rm = { id: "rm-1", role: "RM", name: "Asha" };
const live = (id: string, assignedToId: string | null) => ({ id, clientCode: `C-${id}`, assignedToId, isDeleted: false, mergedIntoId: null });

function deps(over: Partial<AskDeps> = {}): AskDeps {
  return {
    allowRate: vi.fn(async () => true),
    loadSuggestion: vi.fn(async () => ({ id: "s1", status: "OPEN", clientAId: "a", clientBId: "b" })),
    loadClients: vi.fn(async () => [live("a", "rm-1"), live("b", "rm-2")]),
    recipientsFor: vi.fn(async () => ["mgr-1"]),
    alreadyAsked: vi.fn(async () => false),
    notify: vi.fn(async () => undefined),
    ...over,
  };
}

describe("merge policy", () => {
  it("admins and managers may merge any two; an RM only their own; nobody else", () => {
    const mixed = [{ assignedToId: "rm-1" }, { assignedToId: "rm-2" }];
    expect(mayMerge({ id: "x", role: "ADMIN" }, mixed)).toBe(true);
    expect(mayMerge({ id: "x", role: "MANAGER" }, [{ assignedToId: null }, ...mixed])).toBe(true);
    expect(mayMerge(rm, [{ assignedToId: "rm-1" }, { assignedToId: "rm-1" }])).toBe(true);
    expect(mayMerge(rm, mixed)).toBe(false);
    expect(mayMerge(rm, [{ assignedToId: "rm-1" }, { assignedToId: null }])).toBe(false);
    expect(mayMerge({ id: "d", role: "DEALER" }, [{ assignedToId: "d" }])).toBe(false);
  });
  it("an RM needs a manager only for a pair that includes one of their own customers but is not all theirs", () => {
    expect(needsManagerReview(rm, [{ assignedToId: "rm-1" }, { assignedToId: "rm-2" }])).toBe(true);
    expect(needsManagerReview(rm, [{ assignedToId: "rm-1" }, { assignedToId: null }])).toBe(true);
    expect(needsManagerReview(rm, [{ assignedToId: "rm-1" }, { assignedToId: "rm-1" }])).toBe(false);
    expect(needsManagerReview(rm, [{ assignedToId: "rm-2" }, { assignedToId: "rm-3" }])).toBe(false);
    expect(needsManagerReview({ id: "m", role: "MANAGER" }, [{ assignedToId: "rm-1" }, { assignedToId: "rm-2" }])).toBe(false);
  });
});

describe("askManagerToReview", () => {
  it("notifies the manager with ids and codes only (no customer name, mobile or email)", async () => {
    const d = deps();
    expect(await askManagerToReview(d, rm, "s1")).toEqual({ ok: true, notified: 1 });
    expect(d.notify).toHaveBeenCalledWith(["mgr-1"], { suggestionId: "s1", clientId: "a", clientCode: "C-a", requestedById: "rm-1", rmName: "Asha" });
  });
  it("works when the other customer is unassigned", async () => {
    const d = deps({ loadClients: vi.fn(async () => [live("a", null), live("b", "rm-1")]) });
    expect((await askManagerToReview(d, rm, "s1")).ok).toBe(true);
    expect(d.notify).toHaveBeenCalledWith(["mgr-1"], expect.objectContaining({ clientId: "b" }));
  });
  it("is for RMs only", async () => {
    for (const role of ["MANAGER", "ADMIN", "DEALER"]) {
      const d = deps();
      expect(await askManagerToReview(d, { ...rm, role }, "s1")).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(d.notify).not.toHaveBeenCalled();
    }
  });
  it("refuses a pair the RM can merge themselves", async () => {
    const d = deps({ loadClients: vi.fn(async () => [live("a", "rm-1"), live("b", "rm-1")]) });
    expect(await askManagerToReview(d, rm, "s1")).toMatchObject({ ok: false, code: "NOT_NEEDED" });
    expect(d.notify).not.toHaveBeenCalled();
  });
  it("gives the same not-found answer for a pair the RM has no customer in (cannot be used to probe)", async () => {
    const d = deps({ loadClients: vi.fn(async () => [live("a", "rm-2"), live("b", "rm-3")]) });
    const hidden = await askManagerToReview(d, rm, "s1");
    const missing = await askManagerToReview(deps({ loadSuggestion: vi.fn(async () => null) }), rm, "s1");
    expect(hidden).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(hidden).toEqual(missing);
    expect(d.notify).not.toHaveBeenCalled();
  });
  it("refuses a decided suggestion, a merged or archived customer, junk ids, and a flood", async () => {
    expect(await askManagerToReview(deps({ loadSuggestion: vi.fn(async () => ({ id: "s1", status: "MERGED", clientAId: "a", clientBId: "b" })) }), rm, "s1")).toMatchObject({ ok: false, code: "STALE" });
    expect(await askManagerToReview(deps({ loadClients: vi.fn(async () => [live("a", "rm-1"), { ...live("b", "rm-2"), mergedIntoId: "z" }]) }), rm, "s1")).toMatchObject({ ok: false, code: "STALE" });
    expect(await askManagerToReview(deps({ loadClients: vi.fn(async () => [live("a", "rm-1")]) }), rm, "s1")).toMatchObject({ ok: false, code: "STALE" });
    expect(await askManagerToReview(deps(), rm, 42)).toMatchObject({ ok: false, code: "INVALID" });
    const d = deps({ allowRate: vi.fn(async () => false) });
    expect(await askManagerToReview(d, rm, "s1")).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(d.loadSuggestion).not.toHaveBeenCalled();
  });
  it("asks once: a second request for the same pair is acknowledged without another notification", async () => {
    const d = deps({ alreadyAsked: vi.fn(async () => true) });
    expect(await askManagerToReview(d, rm, "s1")).toEqual({ ok: true, notified: 0, alreadyAsked: true });
    expect(d.notify).not.toHaveBeenCalled();
  });
  it("says so when there is nobody to ask", async () => {
    const d = deps({ recipientsFor: vi.fn(async () => []) });
    expect(await askManagerToReview(d, rm, "s1")).toMatchObject({ ok: false, code: "NO_MANAGER" });
  });
});

import { describe, expect, it, vi } from "vitest";

import type { Role } from "@/generated/prisma/client";
import { nativeRoleAllowed, resolveNativeScope, scopeAllows, scopeFilter, type ScopeDb } from "./scope";

/** a -> b -> d, a -> c, e alone. Profiles belong to users u-a ... u-e. */
const EDGES = [
  { id: "a", userId: "u-a", parentPartnerProfileId: null },
  { id: "b", userId: "u-b", parentPartnerProfileId: "a" },
  { id: "c", userId: "u-c", parentPartnerProfileId: "a" },
  { id: "d", userId: "u-d", parentPartnerProfileId: "b" },
  { id: "e", userId: "u-e", parentPartnerProfileId: null },
];
function fakeDb(): ScopeDb {
  return {
    partnerProfile: {
      findUnique: vi.fn(async ({ where }: { where: { userId: string } }) => EDGES.filter((e) => e.userId === where.userId).map((e) => ({ id: e.id }))[0] ?? null),
      findMany: vi.fn(async ({ where }: { where: { parentPartnerProfileId: { in: string[] } } }) =>
        EDGES.filter((e) => e.parentPartnerProfileId && where.parentPartnerProfileId.in.includes(e.parentPartnerProfileId)).map((e) => ({ id: e.id }))),
    },
  };
}
const idsOf = (s: Awaited<ReturnType<typeof resolveNativeScope>>) => (s && s.kind === "ids" ? [...s.ids].sort() : null);
const noVisible = vi.fn(async () => ({ partnerProfileIds: null as string[] | null }));

describe("nativeRoleAllowed", () => {
  const allowed: Role[] = ["ADMIN", "FINANCE", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR"];
  const denied: Role[] = ["MANAGER", "RM", "DEALER"];
  it.each(allowed)("%s may open the workspace", (r) => expect(nativeRoleAllowed(r)).toBe(true));
  it.each(denied)("%s may not", (r) => expect(nativeRoleAllowed(r)).toBe(false));
});

describe("resolveNativeScope", () => {
  it.each(["ADMIN", "FINANCE"] as Role[])("%s sees the whole programme", async (role) => {
    expect(await resolveNativeScope({ id: "x", role }, { db: fakeDb(), visibleScope: noVisible })).toEqual({ kind: "all" });
  });

  it("a partner sees themselves and everyone in their sub-tree", async () => {
    const s = await resolveNativeScope({ id: "u-a", role: "PARTNER" }, { db: fakeDb(), visibleScope: noVisible });
    expect(idsOf(s)).toEqual(["a", "b", "c", "d"]);
  });
  it("a partner lower down sees only their own branch, never a sibling or the parent", async () => {
    const s = await resolveNativeScope({ id: "u-b", role: "AFFILIATE" }, { db: fakeDb(), visibleScope: noVisible });
    expect(idsOf(s)).toEqual(["b", "d"]);
  });
  it("a distributor with no sub-partners sees only themselves", async () => {
    const s = await resolveNativeScope({ id: "u-e", role: "DISTRIBUTOR" }, { db: fakeDb(), visibleScope: noVisible });
    expect(s).toEqual({ kind: "ids", ids: ["e"] });
  });
  it("a partner user with no partner profile sees nothing (and never everything)", async () => {
    const s = await resolveNativeScope({ id: "u-none", role: "PARTNER" }, { db: fakeDb(), visibleScope: noVisible });
    expect(s).toEqual({ kind: "ids", ids: [] });
  });
  it("a team manager gets exactly what the existing visibility rules give", async () => {
    const vs = vi.fn(async () => ({ partnerProfileIds: ["c", "e"] }));
    const s = await resolveNativeScope({ id: "tm", role: "TEAM_MANAGER" }, { db: fakeDb(), visibleScope: vs });
    expect(vs).toHaveBeenCalledWith("tm", "TEAM_MANAGER");
    expect(s).toEqual({ kind: "ids", ids: ["c", "e"] });
  });
  it("a team manager with no assigned partners sees nothing, not the whole programme", async () => {
    const s = await resolveNativeScope({ id: "tm", role: "TEAM_MANAGER" }, { db: fakeDb(), visibleScope: noVisible });
    expect(s).toEqual({ kind: "ids", ids: [] });
  });
  it("returns null for a role that has no access", async () => {
    expect(await resolveNativeScope({ id: "x", role: "RM" }, { db: fakeDb(), visibleScope: noVisible })).toBeNull();
  });
  it("is not fooled by a cycle in the roll-up", async () => {
    const db: ScopeDb = {
      partnerProfile: {
        findUnique: async () => ({ id: "x" }),
        findMany: async ({ where }) => (where.parentPartnerProfileId.in.includes("x") ? [{ id: "y" }] : where.parentPartnerProfileId.in.includes("y") ? [{ id: "x" }] : []),
      },
    };
    const s = await resolveNativeScope({ id: "u", role: "PARTNER" }, { db, visibleScope: noVisible });
    expect(idsOf(s)).toEqual(["x", "y"]);
  });
});

describe("scopeAllows and scopeFilter", () => {
  it("all allows anything", () => {
    expect(scopeAllows({ kind: "all" }, "zzz")).toBe(true);
    expect(scopeFilter({ kind: "all" })).toBeUndefined();
  });
  it("ids allow only their members", () => {
    const s = { kind: "ids" as const, ids: ["a", "b"] };
    expect(scopeAllows(s, "a")).toBe(true);
    expect(scopeAllows(s, "c")).toBe(false);
    expect(scopeFilter(s)).toEqual({ in: ["a", "b"] });
  });
  it("an empty scope matches nothing", () => {
    expect(scopeAllows({ kind: "ids", ids: [] }, "a")).toBe(false);
    expect(scopeFilter({ kind: "ids", ids: [] })).toEqual({ in: [] });
  });
});

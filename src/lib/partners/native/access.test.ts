import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());

const findUnique = vi.fn();
const findMany = vi.fn();
vi.mock("@/lib/db/prisma", () => ({ prisma: { partnerProfile: { findUnique: (...a: unknown[]) => findUnique(...a), findMany: (...a: unknown[]) => findMany(...a) } } }));
const visible = vi.fn();
vi.mock("@/lib/policy/visibility", () => ({ getVisibleScope: (...a: unknown[]) => visible(...a) }));

import { requireNativePartnerWorkspace, requirePartnerWorkspace } from "../access";

const ALL_ROLES = ["ADMIN", "MANAGER", "RM", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "FINANCE"] as const;
const NATIVE_ALLOWED = ["ADMIN", "FINANCE", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR"];

beforeEach(() => {
  resetSession();
  vi.clearAllMocks();
  vi.stubEnv("PARTNER_WORKSPACE_ENABLED", "1");
  vi.stubEnv("PARTNER_SOURCE", "");
  findUnique.mockResolvedValue({ id: "p-own" });
  findMany.mockImplementation(async ({ where }: { where: { parentPartnerProfileId: { in: string[] } } }) => (where.parentPartnerProfileId.in.includes("p-own") ? [{ id: "p-kid" }] : []));
  visible.mockResolvedValue({ partnerProfileIds: ["t1", "t2"] });
});

describe("requirePartnerWorkspace with the native source (the default)", () => {
  it.each(ALL_ROLES)("%s: allowed only for admin, finance, team manager and partner roles", async (role) => {
    asUser({ role });
    const r = await outcomeOf(() => requirePartnerWorkspace());
    expect(r.kind).toBe(NATIVE_ALLOWED.includes(role) ? "returned" : "redirect");
  });

  it("is a 404 while the flag is off, for everyone, before any data is touched", async () => {
    vi.stubEnv("PARTNER_WORKSPACE_ENABLED", "");
    for (const who of [() => asUser({ role: "ADMIN" }), () => asUser({ role: "PARTNER" }), asAnonymous]) {
      who();
      expect(await outcomeOf(() => requirePartnerWorkspace())).toEqual({ kind: "notFound" });
    }
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("sends a signed-out visitor to /login and never reads partner data", async () => {
    asAnonymous();
    expect(await outcomeOf(() => requirePartnerWorkspace())).toEqual({ kind: "redirect", url: "/login" });
    expect(findUnique).not.toHaveBeenCalled();
    expect(visible).not.toHaveBeenCalled();
  });

  it("a user who must change their password is sent there first", async () => {
    asUser({ role: "PARTNER", mustChangePassword: true });
    expect(await outcomeOf(() => requirePartnerWorkspace())).toEqual({ kind: "redirect", url: "/change-password" });
  });

  it("an admin and finance see the whole programme", async () => {
    for (const role of ["ADMIN", "FINANCE"] as const) {
      asUser({ role });
      const r = await outcomeOf(() => requirePartnerWorkspace());
      expect(r.kind === "returned" && (r.value as { scope: unknown }).scope).toEqual({ kind: "all" });
    }
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("a partner user's scope is their own profile and its sub-tree, never everyone", async () => {
    asUser({ id: "user-p", role: "PARTNER" });
    const r = await outcomeOf(() => requirePartnerWorkspace());
    expect(r.kind === "returned" && (r.value as { scope: { kind: string; ids: string[] } }).scope).toEqual({ kind: "ids", ids: ["p-own", "p-kid"] });
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-p" } }));
  });

  it("a partner user whose profile is missing sees an empty scope, not the programme", async () => {
    findUnique.mockResolvedValue(null);
    asUser({ role: "AFFILIATE" });
    const r = await outcomeOf(() => requirePartnerWorkspace());
    expect(r.kind === "returned" && (r.value as { scope: unknown }).scope).toEqual({ kind: "ids", ids: [] });
  });

  it("a team manager's scope comes from the existing visibility rules", async () => {
    asUser({ id: "tm", role: "TEAM_MANAGER" });
    const r = await outcomeOf(() => requirePartnerWorkspace());
    expect(visible).toHaveBeenCalledWith("tm", "TEAM_MANAGER");
    expect(r.kind === "returned" && (r.value as { scope: unknown }).scope).toEqual({ kind: "ids", ids: ["t1", "t2"] });
  });

  it("reports the source it resolved", async () => {
    asUser({ role: "ADMIN" });
    const r = await outcomeOf(() => requirePartnerWorkspace());
    expect(r.kind === "returned" && (r.value as { source: string }).source).toBe("native");
  });
});

describe("requirePartnerWorkspace with the sample source", () => {
  it("keeps the old rule, admin and finance only", async () => {
    vi.stubEnv("PARTNER_SOURCE", "sample");
    for (const role of ALL_ROLES) {
      asUser({ role });
      const r = await outcomeOf(() => requirePartnerWorkspace());
      expect(r.kind).toBe(role === "ADMIN" || role === "FINANCE" ? "returned" : "redirect");
    }
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe("requireNativePartnerWorkspace", () => {
  it("is a 404 when the source is not native", async () => {
    vi.stubEnv("PARTNER_SOURCE", "sample");
    asUser({ role: "ADMIN" });
    expect(await outcomeOf(() => requireNativePartnerWorkspace())).toEqual({ kind: "notFound" });
  });
  it("otherwise behaves like the general gate", async () => {
    asUser({ role: "RM" });
    expect((await outcomeOf(() => requireNativePartnerWorkspace())).kind).toBe("redirect");
    asUser({ role: "FINANCE" });
    expect((await outcomeOf(() => requireNativePartnerWorkspace())).kind).toBe("returned");
  });
});

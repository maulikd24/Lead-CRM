import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRole = vi.fn();
vi.mock("@/lib/auth/require-role", () => ({ requireRole: (...a: unknown[]) => requireRole(...a) }));
let sessionRole = "ADMIN";
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import { PARTNER_WORKSPACE_ROLES, parseListQuery, requirePartnerWorkspace } from "./access";

beforeEach(() => {
  requireRole.mockReset();
  delete process.env.PARTNER_WORKSPACE_ENABLED;
});

describe("requirePartnerWorkspace", () => {
  it("404s before touching auth when the flag is off", async () => {
    await expect(requirePartnerWorkspace()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(requireRole).not.toHaveBeenCalled();
  });
  it("requires ADMIN, FINANCE or TEAM_MANAGER when the flag is on", async () => {
    process.env.PARTNER_WORKSPACE_ENABLED = "1";
    requireRole.mockResolvedValue({ user: { id: "u1" } });
    await requirePartnerWorkspace();
    expect(requireRole).toHaveBeenCalledWith(PARTNER_WORKSPACE_ROLES);
    expect([...PARTNER_WORKSPACE_ROLES].sort()).toEqual(["ADMIN", "FINANCE"]);
  });
  it.each([["ADMIN", true], ["FINANCE", true], ["TEAM_MANAGER", false], ["MANAGER", false], ["RM", false], ["PARTNER", false], ["AFFILIATE", false]] as const)(
    "with the flag on, role %s allowed=%s (using the real role check semantics)",
    async (role, allowed) => {
      process.env.PARTNER_WORKSPACE_ENABLED = "1";
      sessionRole = role;
      requireRole.mockImplementation(async (roles: string[]) => {
        if (!roles.includes(sessionRole)) throw new Error("REDIRECT_HOME");
        return { user: { id: "u", role: sessionRole } };
      });
      if (allowed) await expect(requirePartnerWorkspace()).resolves.toBeTruthy();
      else await expect(requirePartnerWorkspace()).rejects.toThrow("REDIRECT_HOME");
    },
  );
  it("with the flag off every role gets a 404 and auth is never consulted", async () => {
    for (const role of ["ADMIN", "FINANCE", "TEAM_MANAGER"]) {
      sessionRole = role;
      await expect(requirePartnerWorkspace()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(requireRole).not.toHaveBeenCalled();
  });
});

describe("parseListQuery", () => {
  it("accepts known values", () => {
    expect(parseListQuery({ q: " asha ", kyc: "pending", offset: "50", funnel: "DORMANT", status: "PAID" })).toEqual({ q: "asha", kyc: "pending", offset: 50, funnel: "DORMANT", status: "PAID" });
  });
  it("drops unknown filter keys, junk offsets and oversize search", () => {
    const q = parseListQuery({ q: "x".repeat(200), kyc: "bogus", offset: "-4", funnel: "nope", status: "nope" });
    expect(q).toEqual({ q: "x".repeat(80), kyc: undefined, offset: 0, funnel: undefined, status: undefined });
    expect(parseListQuery({ offset: "abc" }).offset).toBe(0);
    expect(parseListQuery({ offset: "99999999999" }).offset).toBe(100000);
  });
  it("takes the first value when a key repeats", () => {
    expect(parseListQuery({ q: ["a", "b"] }).q).toBe("a");
  });
  it("treats 'all' as no filter", () => {
    expect(parseListQuery({ kyc: "all", funnel: "all", status: "all" })).toMatchObject({ kyc: undefined, funnel: undefined, status: undefined });
  });
});

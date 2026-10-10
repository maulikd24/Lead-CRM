import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
const stats = vi.hoisted(() => ({ loadConsentCounts: vi.fn(), loadRecentWithdrawals: vi.fn() }));
vi.mock("@/lib/consent/stats", () => stats);

import ConsentSettingsPage from "./page";

beforeEach(() => {
  resetSession();
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_CONSENT", "1");
  stats.loadConsentCounts.mockResolvedValue([]);
  stats.loadRecentWithdrawals.mockResolvedValue([]);
});

describe("/settings/consent page gate", () => {
  it("sends a signed-out visitor to /login", async () => {
    asAnonymous();
    expect(await outcomeOf(() => ConsentSettingsPage())).toEqual({ kind: "redirect", url: "/login" });
    expect(stats.loadConsentCounts).not.toHaveBeenCalled();
  });
  it.each(["MANAGER", "RM", "FINANCE", "DEALER"] as const)("bounces the %s role before loading any counts", async (role) => {
    asUser({ role });
    expect((await outcomeOf(() => ConsentSettingsPage())).kind).toBe("redirect");
    expect(stats.loadConsentCounts).not.toHaveBeenCalled();
  });
  it("is a 404 for an admin while the flag is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONSENT", "");
    asUser({ role: "ADMIN" });
    expect(await outcomeOf(() => ConsentSettingsPage())).toEqual({ kind: "notFound" });
    expect(stats.loadConsentCounts).not.toHaveBeenCalled();
  });
  it("renders for an admin with the flag on", async () => {
    asUser({ role: "ADMIN" });
    expect((await outcomeOf(() => ConsentSettingsPage())).kind).toBe("returned");
    expect(stats.loadConsentCounts).toHaveBeenCalledTimes(1);
  });
});

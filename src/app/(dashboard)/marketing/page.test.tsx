import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
const report = vi.hoisted(() => ({ getWorkspaceClock: vi.fn(), loadMarketingWorkspace: vi.fn() }));
vi.mock("@/lib/marketing/report", () => report);
vi.mock("@/lib/marketing/creatives-db", () => ({ loadCreatives: vi.fn() }));
const impact = vi.hoisted(() => ({ loadImpact: vi.fn() }));
vi.mock("@/lib/attribution/impact-db", () => impact);

import MarketingPage from "./page";

const clock = { timezone: "Asia/Kolkata", today: "2027-04-20", range: { from: "2027-03-22", to: "2027-04-20", preset: "30d" } };
const open = (searchParams: Record<string, string> = {}) => MarketingPage({ searchParams: Promise.resolve(searchParams) });


beforeEach(() => {
  resetSession();
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_MARKETING", "1");
  report.getWorkspaceClock.mockResolvedValue(clock);
});

describe("/marketing page gate", () => {
  it("sends a signed-out visitor to /login", async () => {
    asAnonymous();
    expect(await outcomeOf(() => open())).toEqual({ kind: "redirect", url: "/login" });
  });
  it.each(["MANAGER", "RM", "DEALER", "FINANCE", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR"] as const)("bounces the %s role", async (role) => {
    asUser({ role });
    expect((await outcomeOf(() => open({ tab: "impact" }))).kind).toBe("redirect");
    expect(impact.loadImpact).not.toHaveBeenCalled();
  });
  it("is a 404 while the marketing flag is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_MARKETING", "");
    asUser({ role: "ADMIN" });
    expect(await outcomeOf(() => open())).toEqual({ kind: "notFound" });
  });
  it.each(["ADMIN", "MARKETING"] as const)("opens for the %s role", async (role) => {
    asUser({ role });
    expect((await outcomeOf(() => open())).kind).toBe("returned");
  });
});

describe("Campaign impact tab (flag NEXT_PUBLIC_ATTRIBUTION)", () => {
  // The tab bar receives its own props, so read them off the element the page builds for it.
  async function tabsOf(params: Record<string, string>) {
    const r = await outcomeOf(() => open(params));
    if (r.kind !== "returned") return null;
    const find = (node: unknown): { attribution?: boolean; tab?: string } | null => {
      if (!node || typeof node !== "object") return null;
      const el = node as { props?: Record<string, unknown> };
      if (el.props && "social" in el.props && "tab" in el.props) return el.props as { attribution?: boolean; tab?: string };
      for (const value of Object.values(el.props ?? {})) for (const child of Array.isArray(value) ? value : [value]) {
        const hit = find(child);
        if (hit) return hit;
      }
      return null;
    };
    return find(r.value);
  }

  it("is not a tab while the flag is off: ?tab=impact falls back to the overview", async () => {
    asUser({ role: "ADMIN" });
    expect(await tabsOf({ tab: "impact" })).toMatchObject({ tab: "overview", attribution: false });
  });
  it("is a tab when the flag is on, for an admin", async () => {
    vi.stubEnv("NEXT_PUBLIC_ATTRIBUTION", "1");
    asUser({ role: "ADMIN" });
    expect(await tabsOf({ tab: "impact" })).toMatchObject({ tab: "impact", attribution: true });
    vi.unstubAllEnvs();
  });
  it("is a tab for MARKETING too, with the flag on", async () => {
    vi.stubEnv("NEXT_PUBLIC_ATTRIBUTION", "1");
    asUser({ role: "MARKETING" as never });
    expect(await tabsOf({ tab: "impact" })).toMatchObject({ tab: "impact", attribution: true });
    vi.unstubAllEnvs();
  });
  it("is not reachable for a manager, even with the flag on: cost and return are ADMIN and MARKETING only, and nothing is loaded", async () => {
    vi.stubEnv("NEXT_PUBLIC_ATTRIBUTION", "1");
    asUser({ role: "MANAGER" });
    expect((await outcomeOf(() => open({ tab: "impact" }))).kind).toBe("redirect");
    expect(impact.loadImpact).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

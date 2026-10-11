import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
const impact = vi.hoisted(() => ({ loadImpact: vi.fn() }));
vi.mock("@/lib/attribution/impact-db", () => impact);
const db = vi.hoisted(() => ({ loadSettings: vi.fn() }));
vi.mock("@/lib/attribution/db", () => db);
vi.mock("@/lib/marketing/report", () => ({ getWorkspaceClock: vi.fn(async () => ({ timezone: "Asia/Kolkata", today: "2027-04-20", range: { from: "2027-03-22", to: "2027-04-20", preset: "30d" } })) }));

import LeadLeakagePage from "./page";

const empty = { report: { rows: [], totals: { missed: 0, late: 0, leads: 0 }, notes: [], unattributedShare: null, currency: "INR" }, customers: {}, groupTotals: {}, hiddenCustomers: 0, freshness: [], slaMinutes: 15, truncated: false, timezone: "Asia/Kolkata" };

beforeEach(() => {
  resetSession();
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_ATTRIBUTION", "1");
  impact.loadImpact.mockResolvedValue(empty);
  db.loadSettings.mockResolvedValue({ slaMinutes: 15, graceMinutes: 0 });
});

const open = (searchParams: Record<string, string> = {}) => LeadLeakagePage({ searchParams: Promise.resolve(searchParams) });

describe("/settings/lead-leakage page gate", () => {
  it("sends a signed-out visitor to /login and loads nothing", async () => {
    asAnonymous();
    expect(await outcomeOf(() => open())).toEqual({ kind: "redirect", url: "/login" });
    expect(impact.loadImpact).not.toHaveBeenCalled();
  });
  it.each(["MANAGER", "RM", "FINANCE", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR"] as const)("bounces the %s role before loading any lead", async (role) => {
    asUser({ role });
    expect((await outcomeOf(() => open())).kind).toBe("redirect");
    expect(impact.loadImpact).not.toHaveBeenCalled();
  });
  it("lets the MARKETING role in and loads the leakage for it, never for an unknown role", async () => {
    asUser({ id: "mk-1", role: "MARKETING" as never });
    expect((await outcomeOf(() => open())).kind).toBe("returned");
    expect(impact.loadImpact.mock.calls[0][1]).toEqual({ id: "mk-1", role: "MARKETING" });
    impact.loadImpact.mockClear();
    asUser({ role: "ANALYST" as never });
    expect((await outcomeOf(() => open())).kind).toBe("redirect");
    expect(impact.loadImpact).not.toHaveBeenCalled();
  });
  it("is a 404 for an admin while the flag is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_ATTRIBUTION", "");
    asUser({ role: "ADMIN" });
    expect(await outcomeOf(() => open())).toEqual({ kind: "notFound" });
    expect(impact.loadImpact).not.toHaveBeenCalled();
  });
  it("renders for an admin with the flag on, loading the leakage as an admin", async () => {
    asUser({ id: "admin-1", role: "ADMIN" });
    expect((await outcomeOf(() => open())).kind).toBe("returned");
    expect(impact.loadImpact).toHaveBeenCalledTimes(1);
    expect(impact.loadImpact.mock.calls[0][1]).toEqual({ id: "admin-1", role: "ADMIN" });
  });
  it("opens on either tab and falls back for anything else", async () => {
    asUser({ role: "ADMIN" });
    for (const tab of ["leakage", "settings", "nope"]) expect((await outcomeOf(() => open({ tab }))).kind).toBe("returned");
  });
});

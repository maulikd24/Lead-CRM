import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
// Any data loader reached by a page is a failure for a gated role: automock them so a call would be visible.
vi.mock("@/lib/partners/load");

import { requirePartnerWorkspace } from "./access";
import { loadSample } from "./load";
import PartnersLayout from "@/app/(dashboard)/partners/layout";
import OverviewPage from "@/app/(dashboard)/partners/page";
import AffiliatesPage from "@/app/(dashboard)/partners/affiliates/page";
import AffiliateDetailPage from "@/app/(dashboard)/partners/affiliates/[id]/page";
import PayoutsPage from "@/app/(dashboard)/partners/payouts/page";
import ReferredUsersPage from "@/app/(dashboard)/partners/referred-users/page";

const ALL_ROLES = ["ADMIN", "MANAGER", "RM", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "FINANCE"] as const;
const ALLOWED = ["ADMIN", "FINANCE"];
const sp = Promise.resolve({});
const pages: [string, () => Promise<unknown>][] = [
  ["overview", () => OverviewPage() as Promise<unknown>],
  ["affiliates", () => AffiliatesPage({ searchParams: sp }) as Promise<unknown>],
  ["affiliate detail", () => AffiliateDetailPage({ params: Promise.resolve({ id: "abc" }) }) as Promise<unknown>],
  ["payouts", () => PayoutsPage({ searchParams: sp }) as Promise<unknown>],
  ["referred users", () => ReferredUsersPage({ searchParams: sp }) as Promise<unknown>],
];

beforeEach(() => {
  resetSession();
  vi.clearAllMocks();
  vi.stubEnv("PARTNER_WORKSPACE_ENABLED", "1");
  // The sample source keeps the admin-and-finance rule these cases pin; the native rule is in native/access.test.ts.
  vi.stubEnv("PARTNER_SOURCE", "sample");
});

describe("requirePartnerWorkspace, with a real role check", () => {
  it.each(ALL_ROLES)("%s: allowed only for ADMIN and FINANCE", async (role) => {
    asUser({ role });
    const r = await outcomeOf(() => requirePartnerWorkspace());
    expect(r.kind).toBe(ALLOWED.includes(role) ? "returned" : "redirect");
  });
  it("sends a signed-out visitor to /login", async () => {
    asAnonymous();
    expect(await outcomeOf(() => requirePartnerWorkspace())).toEqual({ kind: "redirect", url: "/login" });
  });
  it("sends a user who must change their password to /change-password, even an admin", async () => {
    asUser({ role: "ADMIN", mustChangePassword: true });
    expect(await outcomeOf(() => requirePartnerWorkspace())).toEqual({ kind: "redirect", url: "/change-password" });
  });
  it("is a 404 for everyone, signed in or not, while the flag is off (nothing is revealed)", async () => {
    vi.stubEnv("PARTNER_WORKSPACE_ENABLED", "");
    for (const who of [() => asUser({ role: "ADMIN" }), () => asUser({ role: "FINANCE" }), () => asUser({ role: "RM" }), asAnonymous]) {
      who();
      expect(await outcomeOf(() => requirePartnerWorkspace())).toEqual({ kind: "notFound" });
    }
  });
});

describe.each(pages)("partner page: %s", (_name, render) => {
  it.each(ALL_ROLES.filter((r) => !ALLOWED.includes(r)))("bounces %s before loading any referral data", async (role) => {
    asUser({ role });
    expect((await outcomeOf(render)).kind).toBe("redirect");
    expect(loadSample).not.toHaveBeenCalled();
  });
  it("sends a signed-out visitor to /login before loading anything", async () => {
    asAnonymous();
    expect(await outcomeOf(render)).toEqual({ kind: "redirect", url: "/login" });
    expect(loadSample).not.toHaveBeenCalled();
  });
  it("is a 404 for an admin while the flag is off", async () => {
    vi.stubEnv("PARTNER_WORKSPACE_ENABLED", "");
    asUser({ role: "ADMIN" });
    expect(await outcomeOf(render)).toEqual({ kind: "notFound" });
    expect(loadSample).not.toHaveBeenCalled();
  });
});

describe("partner layout", () => {
  it("the layout is a 404 while the flag is off", async () => {
    vi.stubEnv("PARTNER_WORKSPACE_ENABLED", "");
    expect(await outcomeOf(() => PartnersLayout({ children: null }))).toEqual({ kind: "notFound" });
  });
});

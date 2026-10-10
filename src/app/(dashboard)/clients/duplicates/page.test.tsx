import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
const queue = vi.hoisted(() => ({ loadQueue: vi.fn(async () => ({ total: 0, items: [] })) }));
vi.mock("@/lib/identity/merge-review/load", () => queue);
vi.mock("./review-queue", () => ({ ReviewQueue: () => null }));

import DuplicatesPage from "./page";

beforeEach(() => {
  resetSession();
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_MERGE_REVIEW", "1");
});

/** The page's role gate must match the actions' gate: Admin, Manager and RM in; everybody else out. */
describe("the duplicate review page gate", () => {
  it("sends a signed-out visitor to /login", async () => {
    asAnonymous();
    expect(await outcomeOf(() => DuplicatesPage())).toEqual({ kind: "redirect", url: "/login" });
  });
  it.each(["ADMIN", "MANAGER", "RM"] as const)("opens for %s", async (role) => {
    asUser({ role });
    expect((await outcomeOf(() => DuplicatesPage())).kind).toBe("returned");
  });
  it.each(["DEALER", "FINANCE", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "TEAM_MANAGER"] as const)("redirects %s away", async (role) => {
    asUser({ role });
    expect((await outcomeOf(() => DuplicatesPage())).kind).toBe("redirect");
    expect(queue.loadQueue).not.toHaveBeenCalled();
  });
});

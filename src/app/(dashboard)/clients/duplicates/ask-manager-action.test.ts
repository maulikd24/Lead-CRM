import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/stage-engine/next-action", () => ({ syncNextAction: vi.fn(async () => undefined) }));
vi.mock("@/lib/identity/merge-review/wiring", () => ({ decideDeps: vi.fn(), revealDeps: vi.fn() }));
vi.mock("@/lib/identity/merge-review/load", () => ({ loadComparison: vi.fn() }));

// The ask logic is real; only the data layer behind it is faked.
const fake = vi.hoisted(() => ({ notify: vi.fn(async () => undefined), owners: ["rm-1", "rm-2"] as (string | null)[] }));
vi.mock("@/lib/clients/ask-manager-wiring", () => ({
  askManagerDeps: () => ({
    allowRate: async () => true,
    loadSuggestion: async () => ({ id: "s1", status: "OPEN", clientAId: "a", clientBId: "b" }),
    loadClients: async () => [
      { id: "a", clientCode: "C-a", assignedToId: fake.owners[0], isDeleted: false, mergedIntoId: null },
      { id: "b", clientCode: "C-b", assignedToId: fake.owners[1], isDeleted: false, mergedIntoId: null },
    ],
    recipientsFor: async () => ["mgr-1"],
    alreadyAsked: async () => false,
    notify: fake.notify,
  }),
}));

import { askManagerToReviewAction } from "./actions";

beforeEach(() => {
  resetSession();
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_MERGE_REVIEW", "1");
  fake.owners = ["rm-1", "rm-2"];
});

describe("askManagerToReviewAction", () => {
  it("sends a signed-out caller to /login and notifies nobody", async () => {
    asAnonymous();
    expect(await outcomeOf(() => askManagerToReviewAction("s1"))).toEqual({ kind: "redirect", url: "/login" });
    expect(fake.notify).not.toHaveBeenCalled();
  });
  it("is off with the duplicate-review flag off", async () => {
    vi.stubEnv("NEXT_PUBLIC_MERGE_REVIEW", "");
    asUser({ id: "rm-1", role: "RM" });
    expect(await outcomeOf(() => askManagerToReviewAction("s1"))).toMatchObject({ kind: "returned", value: { ok: false } });
    expect(fake.notify).not.toHaveBeenCalled();
  });
  it("creates the notification for an RM whose customer is in the pair, naming the session user", async () => {
    asUser({ id: "rm-1", role: "RM", name: "Asha" });
    expect(await outcomeOf(() => askManagerToReviewAction("s1"))).toMatchObject({ kind: "returned", value: { ok: true, notified: 1 } });
    expect(fake.notify).toHaveBeenCalledWith(["mgr-1"], { suggestionId: "s1", clientId: "a", clientCode: "C-a", requestedById: "rm-1", rmName: "Asha" });
  });
  it("refuses an RM who owns neither customer, exactly like a missing suggestion", async () => {
    asUser({ id: "rm-9", role: "RM" });
    expect(await outcomeOf(() => askManagerToReviewAction("s1"))).toMatchObject({ kind: "returned", value: { ok: false, code: "NOT_FOUND" } });
    expect(fake.notify).not.toHaveBeenCalled();
  });
  it("refuses an RM who owns both customers (they can merge themselves)", async () => {
    fake.owners = ["rm-1", "rm-1"];
    asUser({ id: "rm-1", role: "RM" });
    expect(await outcomeOf(() => askManagerToReviewAction("s1"))).toMatchObject({ value: { ok: false, code: "NOT_NEEDED" } });
  });
  it.each(["MANAGER", "ADMIN", "DEALER", "PARTNER", "FINANCE"] as const)("is not for the %s role", async (role) => {
    asUser({ id: "rm-1", role });
    const r = await outcomeOf(() => askManagerToReviewAction("s1"));
    if (r.kind === "returned") expect(r.value).toMatchObject({ ok: false });
    expect(fake.notify).not.toHaveBeenCalled();
  });
});

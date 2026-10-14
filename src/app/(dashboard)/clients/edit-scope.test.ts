import { beforeEach, describe, expect, it, vi } from "vitest";

import { asUser, form, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());

const db = vi.hoisted(() => ({
  client: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn() },
  accountHolder: { findUniqueOrThrow: vi.fn() },
  user: { findMany: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));

import { updateClientAction } from "./actions";
import { addHolderAction, updateHolderAction } from "./holder-actions";

beforeEach(() => {
  resetSession();
  vi.clearAllMocks();
  db.user.findMany.mockResolvedValue([{ id: "rm-team" }]);
  db.client.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ other: { assignedToId: "rm-9", isDeleted: false }, own: { assignedToId: "rm-1", isDeleted: false }, team: { assignedToId: "rm-team", isDeleted: false } })[where.id] ?? null);
  db.accountHolder.findUniqueOrThrow.mockResolvedValue({ id: "h1", clientId: "other" });
});

describe("edit actions are limited to customers in the caller's scope", () => {
  it("an RM cannot edit, add a holder to, or edit a holder of another RM's customer", async () => {
    asUser({ id: "rm-1", role: "RM" });
    expect((await outcomeOf(() => updateClientAction("other", form({ name: "X" })))).kind).toBe("threw");
    expect((await outcomeOf(() => addHolderAction("other", { name: "H", position: 2 } as never))).kind).toBe("threw");
    expect((await outcomeOf(() => updateHolderAction("h1", { name: "H" }))).kind).toBe("threw");
    expect(db.client.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it("a Manager cannot touch a customer outside their team", async () => {
    asUser({ id: "mgr-1", role: "MANAGER" });
    expect((await outcomeOf(() => updateClientAction("other", form({ name: "X" })))).kind).toBe("threw");
    expect(db.client.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it("lets the RM past the guard for their own customer, and a Manager for a team customer", async () => {
    db.client.findUniqueOrThrow.mockRejectedValue(new Error("reached"));
    asUser({ id: "rm-1", role: "RM" });
    expect(await outcomeOf(() => updateClientAction("own", form({ name: "X" })))).toMatchObject({ kind: "threw", error: expect.objectContaining({ message: "reached" }) });
    asUser({ id: "mgr-1", role: "MANAGER" });
    expect(await outcomeOf(() => updateClientAction("team", form({ name: "X" })))).toMatchObject({ kind: "threw", error: expect.objectContaining({ message: "reached" }) });
  });
});

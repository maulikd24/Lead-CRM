import { beforeEach, describe, expect, it, vi } from "vitest";

import { asUser, form, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());

const db = vi.hoisted(() => ({
  client: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn() },
  accountHolder: { findUniqueOrThrow: vi.fn() },
  user: { findMany: vi.fn() },
  tradingAccount: { count: vi.fn().mockResolvedValue(0) },
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

describe("changing a PAN needs the reveal rule: Admin or the assigned RM only", () => {
  const existing = { id: "team", assignedToId: "rm-team", name: "T", mobile: "9876543123", email: null, pan: "ABCDE1234F", ckycRef: null };
  it("a Manager cannot change a PAN, even on a team customer", async () => {
    db.client.findUniqueOrThrow.mockResolvedValue(existing);
    asUser({ id: "mgr-1", role: "MANAGER" });
    const out = await outcomeOf(() => updateClientAction("team", form({ pan: "PQRST5678U" })));
    expect(out).toMatchObject({ kind: "threw", error: expect.objectContaining({ message: expect.stringContaining("PAN") }) });
  });
  it("a blank PAN field means unchanged and does not trip the rule", async () => {
    db.client.findUniqueOrThrow.mockRejectedValue(new Error("reached"));
    asUser({ id: "mgr-1", role: "MANAGER" });
    expect(await outcomeOf(() => updateClientAction("team", form({ name: "X", pan: "" })))).toMatchObject({ kind: "threw", error: expect.objectContaining({ message: "reached" }) });
  });
  it("a Manager cannot change a holder's PAN either; a blank PAN is unchanged", async () => {
    db.accountHolder.findUniqueOrThrow.mockResolvedValue({ id: "h1", clientId: "team", pan: "ABCDE1234F" });
    asUser({ id: "mgr-1", role: "MANAGER" });
    const out = await outcomeOf(() => updateHolderAction("h1", { pan: "PQRST5678U" }));
    expect(out).toMatchObject({ kind: "threw", error: expect.objectContaining({ message: expect.stringContaining("PAN") }) });
  });
});

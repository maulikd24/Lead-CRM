import { describe, expect, it, vi } from "vitest";
import { canChangeConsent, changeConsent, type ChangeDeps, type ChangeInput } from "./change";
import { createMemoryStore } from "./memory-store";

const NOW = new Date("2026-10-09T10:00:00Z");
type User = NonNullable<ChangeDeps["user"]>;
const admin: User = { id: "a1", role: "ADMIN" };
const manager: User = { id: "m1", role: "MANAGER" };
const rm: User = { id: "rm1", role: "RM" };
const otherRm: User = { id: "rm2", role: "RM" };

const input: ChangeInput = { clientId: "c1", purpose: "MARKETING_COMMS", channel: "", status: "WITHDRAWN", reason: "Customer asked on the phone" };

function setup(over: Partial<ChangeDeps> = {}) {
  const store = createMemoryStore();
  const afterWrite = vi.fn(async () => {});
  const deps: ChangeDeps = {
    flagOn: () => true,
    user: rm,
    loadClient: async (id) => (id === "c1" ? { id: "c1", assignedToId: "rm1" } : null),
    visibleUserIds: async () => ["m1", "rm1"],
    store,
    now: () => NOW,
    afterWrite,
    ...over,
  };
  return { deps, store, afterWrite };
}

describe("canChangeConsent", () => {
  it("lets an admin change anyone", () => expect(canChangeConsent(admin, { assignedToId: null }, null)).toBe(true));
  it("lets the assigned RM, not another RM", () => {
    expect(canChangeConsent(rm, { assignedToId: "rm1" }, ["rm1"])).toBe(true);
    expect(canChangeConsent(otherRm, { assignedToId: "rm1" }, ["rm2"])).toBe(false);
    expect(canChangeConsent(rm, { assignedToId: null }, ["rm1"])).toBe(false);
  });
  it("lets a manager act for their team and for unassigned leads, not for other teams", () => {
    expect(canChangeConsent(manager, { assignedToId: "rm1" }, ["m1", "rm1"])).toBe(true);
    expect(canChangeConsent(manager, { assignedToId: null }, ["m1", "rm1"])).toBe(true);
    expect(canChangeConsent(manager, { assignedToId: "rmX" }, ["m1", "rm1"])).toBe(false);
  });
  it.each(["DEALER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "FINANCE", "TEAM_MANAGER"] as const)("refuses %s", (role) => {
    expect(canChangeConsent({ id: "x", role }, { assignedToId: "x" }, null)).toBe(false);
  });
});

describe("changeConsent", () => {
  it("writes a withdrawal for the assigned RM and runs the after-hook", async () => {
    const { deps, store, afterWrite } = setup();
    expect(await changeConsent(deps, input)).toEqual({ ok: true });
    const rows = await store.listForClient("c1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ purpose: "MARKETING_COMMS", channel: null, status: "WITHDRAWN", source: "RM_RECORDED", capturedById: "rm1", reason: "Customer asked on the phone" });
    expect(afterWrite).toHaveBeenCalledTimes(1);
  });

  it("never trusts a user id from the input: the actor comes from the session", async () => {
    const { deps, store } = setup();
    await changeConsent(deps, { ...input, capturedById: "someone-else", source: "API" } as unknown as ChangeInput);
    const [row] = await store.listForClient("c1");
    expect(row.capturedById).toBe("rm1");
    expect(row.source).toBe("RM_RECORDED");
  });

  it("refuses when the feature flag is off", async () => {
    const { deps, store } = setup({ flagOn: () => false });
    expect(await changeConsent(deps, input)).toEqual({ ok: false, error: "Not available" });
    expect(await store.listForClient("c1")).toEqual([]);
  });
  it("refuses a signed-out caller", async () => {
    const { deps, store } = setup({ user: null });
    expect(await changeConsent(deps, input)).toEqual({ ok: false, error: "Not authorized" });
    expect(await store.listForClient("c1")).toEqual([]);
  });
  it("refuses an RM who does not own the customer, with the same answer as a missing customer", async () => {
    const { deps, store } = setup({ user: otherRm, visibleUserIds: async () => ["rm2"] });
    const a = await changeConsent(deps, input);
    const b = await changeConsent(deps, { ...input, clientId: "missing" });
    expect(a).toEqual({ ok: false, error: "Not authorized" });
    expect(b).toEqual(a);
    expect(await store.listForClient("c1")).toEqual([]);
  });
  it("refuses roles outside admin, manager and RM", async () => {
    const { deps } = setup({ user: { id: "d1", role: "DEALER" } });
    expect(await changeConsent(deps, input)).toEqual({ ok: false, error: "Not authorized" });
  });
  it("refuses a manager outside their hierarchy", async () => {
    const { deps } = setup({ user: manager, visibleUserIds: async () => ["m1"] });
    expect(await changeConsent(deps, input)).toEqual({ ok: false, error: "Not authorized" });
  });
  it("requires a reason and writes nothing without one", async () => {
    const { deps, store, afterWrite } = setup();
    expect(await changeConsent(deps, { ...input, reason: "" })).toEqual({ ok: false, error: "A reason is required" });
    expect(await store.listForClient("c1")).toEqual([]);
    expect(afterWrite).not.toHaveBeenCalled();
  });
  it("rejects unknown purposes, statuses and channels with a message, not a throw", async () => {
    const { deps } = setup();
    expect((await changeConsent(deps, { ...input, purpose: "X" })).ok).toBe(false);
    expect((await changeConsent(deps, { ...input, status: "MAYBE" })).ok).toBe(false);
    expect((await changeConsent(deps, { ...input, channel: "pigeon" })).ok).toBe(false);
  });
  it("lets an admin record a do-not-contact flag on one channel", async () => {
    const { deps, store } = setup({ user: admin, visibleUserIds: async () => null });
    expect(await changeConsent(deps, { clientId: "c1", purpose: "DO_NOT_CONTACT", channel: "sms", status: "GRANTED", reason: "Written request" })).toEqual({ ok: true });
    expect((await store.listForClient("c1"))[0]).toMatchObject({ purpose: "DO_NOT_CONTACT", channel: "sms", status: "GRANTED" });
  });
});

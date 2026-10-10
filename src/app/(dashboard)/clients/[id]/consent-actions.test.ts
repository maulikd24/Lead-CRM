import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";
import { createMemoryStore } from "@/lib/consent/memory-store";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());

const db = vi.hoisted(() => ({ client: { findFirst: vi.fn() }, user: { findMany: vi.fn() } }));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
const store = vi.hoisted(() => ({ current: null as null | import("@/lib/consent/ledger").ConsentStore }));
vi.mock("@/lib/consent/store-prisma", () => ({ prismaConsentStore: { append: (r: never) => store.current!.append(r), listForClient: (c: string) => store.current!.listForClient(c), listForClients: (c: string[]) => store.current!.listForClients(c) } }));
const logActivity = vi.hoisted(() => vi.fn());
vi.mock("@/lib/activities/log-activity", () => ({ logActivity }));

import { changeConsentAction } from "./consent-actions";

const input = { clientId: "client-1", purpose: "MARKETING_COMMS", channel: "whatsapp", status: "WITHDRAWN", reason: "Customer asked on a call" };

beforeEach(() => {
  resetSession();
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_CONSENT", "1");
  store.current = createMemoryStore();
  db.client.findFirst.mockResolvedValue({ id: "client-1", assignedToId: "rm-1" });
  db.user.findMany.mockResolvedValue([]);
});

describe("changeConsentAction authz", () => {
  it("sends a signed-out caller to /login and writes nothing", async () => {
    asAnonymous();
    expect(await outcomeOf(() => changeConsentAction(input))).toEqual({ kind: "redirect", url: "/login" });
    expect(await store.current!.listForClient("client-1")).toHaveLength(0);
  });
  it("sends a user who must change their password to /change-password", async () => {
    asUser({ role: "ADMIN", mustChangePassword: true });
    expect(await outcomeOf(() => changeConsentAction(input))).toEqual({ kind: "redirect", url: "/change-password" });
  });
  it("is 'Not available' and writes nothing while the flag is off, even for an admin", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONSENT", "");
    asUser({ role: "ADMIN" });
    expect(await outcomeOf(() => changeConsentAction(input))).toEqual({ kind: "returned", value: { ok: false, error: "Not available" } });
    expect(db.client.findFirst).not.toHaveBeenCalled();
  });
  it.each(["DEALER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "TEAM_MANAGER", "FINANCE"] as const)("refuses the %s role", async (role) => {
    asUser({ role });
    expect(await outcomeOf(() => changeConsentAction(input))).toEqual({ kind: "returned", value: { ok: false, error: "Not authorized" } });
    expect(await store.current!.listForClient("client-1")).toHaveLength(0);
  });
  it("refuses an RM for a customer assigned to someone else, with the same answer as a missing customer", async () => {
    asUser({ id: "rm-2", role: "RM" });
    const other = await outcomeOf(() => changeConsentAction(input));
    db.client.findFirst.mockResolvedValue(null);
    const missing = await outcomeOf(() => changeConsentAction(input));
    expect(other).toEqual(missing);
    expect(other).toEqual({ kind: "returned", value: { ok: false, error: "Not authorized" } });
  });
  it("refuses a manager for a customer outside their hierarchy", async () => {
    asUser({ id: "mgr-1", role: "MANAGER" });
    expect(await outcomeOf(() => changeConsentAction(input))).toEqual({ kind: "returned", value: { ok: false, error: "Not authorized" } });
  });
  it("accepts a manager for a direct report's customer", async () => {
    db.user.findMany.mockResolvedValue([{ id: "rm-1" }]);
    asUser({ id: "mgr-1", role: "MANAGER" });
    expect(await outcomeOf(() => changeConsentAction(input))).toEqual({ kind: "returned", value: { ok: true } });
  });
});

describe("changeConsentAction writes", () => {
  it("takes the actor and source from the session, ignoring anything the browser adds", async () => {
    asUser({ id: "rm-1", role: "RM" });
    const forged = { ...input, capturedById: "someone-else", source: "APP_SIGNUP", capturedAt: "2020-01-01" } as typeof input;
    expect((await outcomeOf(() => changeConsentAction(forged))).kind).toBe("returned");
    const rows = await store.current!.listForClient("client-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ capturedById: "rm-1", source: "RM_RECORDED", status: "WITHDRAWN" });
    expect(logActivity).toHaveBeenCalledTimes(1);
  });
  it("requires a reason for a team-member entry", async () => {
    asUser({ role: "ADMIN" });
    const r = await outcomeOf(() => changeConsentAction({ ...input, reason: "" }));
    expect(r.kind === "returned" && r.value.ok).toBe(false);
    expect(await store.current!.listForClient("client-1")).toHaveLength(0);
  });
});

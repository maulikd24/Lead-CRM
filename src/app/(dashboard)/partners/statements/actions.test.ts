import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());

const findUnique = vi.fn();
const findMany = vi.fn();
vi.mock("@/lib/db/prisma", () => ({ prisma: { partnerProfile: { findUnique: (...a: unknown[]) => findUnique(...a), findMany: (...a: unknown[]) => findMany(...a) } } }));
vi.mock("@/lib/policy/visibility", () => ({ getVisibleScope: vi.fn(async () => ({ partnerProfileIds: ["t1"] })) }));
const raise = vi.fn();
vi.mock("@/lib/partners/statement-query", async (orig) => ({ ...(await orig<object>()), raiseStatementQuery: (...a: unknown[]) => raise(...a) }));

import { raiseStatementQueryAction } from "./actions";

const input = { partnerId: "p-own", period: "m-2026-09", lineRef: "acc1", message: "This amount looks too low" };

beforeEach(() => {
  resetSession();
  vi.clearAllMocks();
  vi.stubEnv("PARTNER_WORKSPACE_ENABLED", "1");
  vi.stubEnv("PARTNER_SOURCE", "");
  findUnique.mockResolvedValue({ id: "p-own" });
  findMany.mockResolvedValue([]);
  raise.mockResolvedValue({ ok: true, queryId: "q1", taskId: "t1", duplicate: false });
});

describe("raiseStatementQueryAction", () => {
  it.each(["MANAGER", "RM", "DEALER"] as const)("%s is bounced and nothing is filed", async (role) => {
    asUser({ role });
    expect((await outcomeOf(() => raiseStatementQueryAction(input))).kind).toBe("redirect");
    expect(raise).not.toHaveBeenCalled();
  });
  it("sends a signed-out visitor away", async () => {
    asAnonymous();
    expect((await outcomeOf(() => raiseStatementQueryAction(input))).kind).toBe("redirect");
  });
  it("is a 404 while the flag is off", async () => {
    vi.stubEnv("PARTNER_WORKSPACE_ENABLED", "");
    asUser({ role: "PARTNER" });
    expect(await outcomeOf(() => raiseStatementQueryAction(input))).toEqual({ kind: "notFound" });
  });
  it("files the query as the signed-in user, with the scope the session gives, never one from the request", async () => {
    const u = asUser({ role: "PARTNER" });
    const r = await raiseStatementQueryAction(input);
    expect(r).toEqual({ ok: true, queryId: "q1", taskId: "t1", duplicate: false });
    const [, actor, scope, sent] = raise.mock.calls[0];
    expect(actor).toEqual({ id: u.id, role: "PARTNER" });
    expect(scope).toEqual({ kind: "ids", ids: ["p-own"], detailIds: ["p-own"] });
    expect(sent).toEqual(input);
  });
  it("a team manager's scope has no line detail, so the data layer refuses", async () => {
    asUser({ role: "TEAM_MANAGER" });
    await raiseStatementQueryAction(input);
    expect(raise.mock.calls[0][2]).toEqual({ kind: "ids", ids: ["t1"], detailIds: [] });
  });
  it("admin and finance act on the whole programme", async () => {
    asUser({ role: "FINANCE" });
    await raiseStatementQueryAction(input);
    expect(raise.mock.calls[0][2]).toEqual({ kind: "all" });
  });
  it("ignores extra fields a caller sneaks in, and refuses a malformed shape", async () => {
    asUser({ role: "PARTNER" });
    await raiseStatementQueryAction({ ...input, partnerId: "p-own", extra: "x" } as never);
    expect(raise.mock.calls[0][3]).toEqual(input);
    expect(await raiseStatementQueryAction({ partnerId: 5 } as never)).toMatchObject({ ok: false, code: "invalid" });
  });
});

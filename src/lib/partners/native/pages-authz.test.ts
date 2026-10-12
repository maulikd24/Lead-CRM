import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());

const findUnique = vi.fn();
const findMany = vi.fn();
const auditCreate = vi.fn();
vi.mock("@/lib/db/prisma", () => ({ prisma: { partnerProfile: { findUnique: (...a: unknown[]) => findUnique(...a), findMany: (...a: unknown[]) => findMany(...a) }, auditLog: { create: (...a: unknown[]) => auditCreate(...a) }, partnerWorkspaceSetting: { findMany: async () => [] } } }));
vi.mock("@/lib/policy/visibility", () => ({ getVisibleScope: vi.fn(async () => ({ partnerProfileIds: ["t1"] })) }));
// Any data loader reached by a page is a failure for a gated role: automock them so a call would be visible.
vi.mock("@/lib/partners/load");
const getStatement = vi.fn();
const createNativePort = vi.fn((_db: unknown, _scope: unknown) => ({ getStatement: (...a: unknown[]) => getStatement(...a) }));
vi.mock("@/lib/partners/native/queries", async (orig) => ({ ...(await orig<object>()), createNativePort: (db: unknown, scope: unknown) => createNativePort(db, scope) }));

import OverviewPage from "@/app/(dashboard)/partners/page";
import AffiliatesPage from "@/app/(dashboard)/partners/affiliates/page";
import AffiliateDetailPage from "@/app/(dashboard)/partners/affiliates/[id]/page";
import ReferredPage from "@/app/(dashboard)/partners/referred-users/page";
import PayoutsPage from "@/app/(dashboard)/partners/payouts/page";
import NetworkPage from "@/app/(dashboard)/partners/network/page";
import CommissionsPage from "@/app/(dashboard)/partners/commissions/page";
import StatementsPage from "@/app/(dashboard)/partners/statements/page";
import StatementPage from "@/app/(dashboard)/partners/statements/[partnerId]/page";
import { GET as exportCsv } from "@/app/(dashboard)/partners/statements/[partnerId]/export/route";
import PrintPage from "@/app/partner-statement/[partnerId]/page";
import { loadNative, loadNativeSummaryOnce } from "@/lib/partners/load";

const ALL_ROLES = ["ADMIN", "MANAGER", "RM", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "FINANCE"] as const;
const DENIED = ["MANAGER", "RM", "DEALER"] as const;
const sp = Promise.resolve({});
const pages: [string, () => Promise<unknown>][] = [
  ["overview", () => OverviewPage() as Promise<unknown>],
  ["affiliates", () => AffiliatesPage({ searchParams: sp }) as Promise<unknown>],
  ["affiliate detail", () => AffiliateDetailPage({ params: Promise.resolve({ id: "abc" }) }) as Promise<unknown>],
  ["referred", () => ReferredPage({ searchParams: sp }) as Promise<unknown>],
  ["payouts", () => PayoutsPage({ searchParams: sp }) as Promise<unknown>],
  ["network", () => NetworkPage({ searchParams: sp }) as Promise<unknown>],
  ["commissions", () => CommissionsPage({ searchParams: sp }) as Promise<unknown>],
  ["statements", () => StatementsPage({ searchParams: sp }) as Promise<unknown>],
  ["statement", () => StatementPage({ params: Promise.resolve({ partnerId: "abc" }), searchParams: sp }) as Promise<unknown>],
  ["print statement", () => PrintPage({ params: Promise.resolve({ partnerId: "abc" }), searchParams: sp }) as Promise<unknown>],
];

beforeEach(() => {
  resetSession();
  vi.clearAllMocks();
  vi.stubEnv("PARTNER_WORKSPACE_ENABLED", "1");
  vi.stubEnv("PARTNER_SOURCE", "");
  findUnique.mockResolvedValue({ id: "p-own" });
  findMany.mockImplementation(async ({ where }: { where: { parentPartnerProfileId: { in: string[] } } }) => (where.parentPartnerProfileId.in.includes("p-own") ? [{ id: "p-kid" }] : []));
  vi.mocked(loadNative).mockResolvedValue({ status: "error", kind: "server" });
  vi.mocked(loadNativeSummaryOnce).mockResolvedValue({ status: "error", kind: "server" });
  getStatement.mockResolvedValue(null);
});

describe.each(pages)("native partner page: %s", (_name, render) => {
  it.each(DENIED)("bounces %s before loading anything", async (role) => {
    asUser({ role });
    expect((await outcomeOf(render)).kind).toBe("redirect");
    expect(loadNative).not.toHaveBeenCalled();
    expect(loadNativeSummaryOnce).not.toHaveBeenCalled();
    expect(createNativePort).not.toHaveBeenCalled();
  });
  it("sends a signed-out visitor to /login before loading anything", async () => {
    asAnonymous();
    expect(await outcomeOf(render)).toEqual({ kind: "redirect", url: "/login" });
    expect(loadNative).not.toHaveBeenCalled();
    expect(createNativePort).not.toHaveBeenCalled();
  });
  it("is a 404 for an admin while the flag is off", async () => {
    vi.stubEnv("PARTNER_WORKSPACE_ENABLED", "");
    asUser({ role: "ADMIN" });
    expect(await outcomeOf(render)).toEqual({ kind: "notFound" });
    expect(loadNative).not.toHaveBeenCalled();
  });
});

describe("what each allowed role can read", () => {
  const readers: [string, () => Promise<unknown>][] = pages.filter(([n]) => !["statement", "print statement", "affiliate detail", "overview"].includes(n));

  it.each(readers)("%s: a partner user reads through their own sub-tree only", async (_n, render) => {
    asUser({ id: "user-p", role: "PARTNER" });
    await outcomeOf(render);
    expect(loadNative).toHaveBeenCalledTimes(1);
    const access = vi.mocked(loadNative).mock.calls[0][0];
    expect(access.scope).toEqual({ kind: "ids", ids: ["p-own", "p-kid"], detailIds: ["p-own"] });
  });
  it.each(readers)("%s: an admin reads the whole programme", async (_n, render) => {
    asUser({ role: "ADMIN" });
    await outcomeOf(render);
    expect(vi.mocked(loadNative).mock.calls[0][0].scope).toEqual({ kind: "all" });
  });
  it("the overview reads through the same scope", async () => {
    asUser({ id: "user-p", role: "DISTRIBUTOR" });
    await outcomeOf(() => OverviewPage());
    expect(vi.mocked(loadNativeSummaryOnce).mock.calls[0][0].scope).toEqual({ kind: "ids", ids: ["p-own", "p-kid"], detailIds: ["p-own"] });
  });
  it("a team manager reads exactly the partners the existing hierarchy rules give", async () => {
    asUser({ role: "TEAM_MANAGER" });
    await outcomeOf(() => AffiliatesPage({ searchParams: sp }) as Promise<unknown>);
    expect(vi.mocked(loadNative).mock.calls[0][0].scope).toEqual({ kind: "ids", ids: ["t1"], detailIds: [] });
  });
  it("a partner user with no profile reads an empty scope, never everything", async () => {
    findUnique.mockResolvedValue(null);
    asUser({ role: "AFFILIATE" });
    await outcomeOf(() => AffiliatesPage({ searchParams: sp }) as Promise<unknown>);
    expect(vi.mocked(loadNative).mock.calls[0][0].scope).toEqual({ kind: "ids", ids: [], detailIds: [] });
  });
});

describe("the source decides which pages exist", () => {
  it("network, commissions and statements are 404 for an admin under the sample source", async () => {
    vi.stubEnv("PARTNER_SOURCE", "sample");
    asUser({ role: "ADMIN" });
    for (const name of ["network", "commissions", "statements", "statement", "print statement"]) {
      const render = pages.find(([n]) => n === name)![1];
      expect(await outcomeOf(render), name).toEqual({ kind: "notFound" });
    }
  });
  it("under the sample source a partner user is still bounced, as before", async () => {
    vi.stubEnv("PARTNER_SOURCE", "sample");
    asUser({ role: "PARTNER" });
    expect((await outcomeOf(() => OverviewPage() as Promise<unknown>)).kind).toBe("redirect");
  });
});

describe("statement CSV export", () => {
  const STATEMENT = {
    partner: { id: "p-own", code: "PTR-00001", name: "Asha Associates", type: "PARTNER", tier: "GOLD", status: "ACTIVE", bankLast4: "4321", bankVerifiedAt: "2026-08-01T00:00:00.000Z" },
    period: { kind: "run", start: "2026-08-31T18:30:00.000Z", end: "2026-09-30T18:30:00.000Z", key: "run1" },
    run: { id: "run1", status: "APPROVED" },
    payout: { id: "py1", status: "APPROVED", externalRef: null, reconciledAt: null, totalAccrual: "100", adjustment: "0", net: "100" },
    lines: [{ id: "l1", date: "2026-09-05T05:00:00.000Z", revenueType: "BROKERAGE", clientCode: "CL-00001", amount: "100" }],
    adjustments: [],
  };
  const call = (partnerId: string, run = "run1") => exportCsv(new Request(`https://crm.test/partners/statements/${partnerId}/export?run=${run}`), { params: Promise.resolve({ partnerId }) });

  it.each(DENIED)("bounces %s", async (role) => {
    asUser({ role });
    expect((await outcomeOf(() => call("p-own"))).kind).toBe("redirect");
    expect(getStatement).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });
  it("sends a signed-out visitor to /login", async () => {
    asAnonymous();
    expect(await outcomeOf(() => call("p-own"))).toEqual({ kind: "redirect", url: "/login" });
    expect(auditCreate).not.toHaveBeenCalled();
  });
  it("a partner user is given their own statement as a CSV attachment, and an audit entry is written", async () => {
    getStatement.mockResolvedValue(STATEMENT);
    const me = asUser({ id: "user-p", role: "PARTNER" });
    const r = await outcomeOf(() => call("p-own"));
    expect(r.kind).toBe("returned");
    const res = (r as { value: Response }).value;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="statement-PTR-00001-run1.csv"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toContain("Net before tax");
    expect(createNativePort.mock.calls[0][1]).toEqual({ kind: "ids", ids: ["p-own", "p-kid"], detailIds: ["p-own"] });
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: me.id, action: "partner_statement_exported", entityId: "p-own" }) });
  });
  it("a statement outside the caller's scope is a 404 and writes no audit entry", async () => {
    getStatement.mockResolvedValue(null); // the port returns null for a partner outside the scope
    asUser({ role: "PARTNER" });
    const res = ((await outcomeOf(() => call("someone-else"))) as { value: Response }).value;
    expect(res.status).toBe(404);
    expect(auditCreate).not.toHaveBeenCalled();
  });
  it("an admin's export is read through the whole programme", async () => {
    getStatement.mockResolvedValue(STATEMENT);
    asUser({ role: "FINANCE" });
    await outcomeOf(() => call("p-own"));
    expect(createNativePort.mock.calls[0][1]).toEqual({ kind: "all" });
  });
  it("no file leaves when the audit write fails", async () => {
    getStatement.mockResolvedValue(STATEMENT);
    auditCreate.mockRejectedValueOnce(new Error("db down"));
    asUser({ role: "ADMIN" });
    const r = await outcomeOf(() => call("p-own"));
    expect(r.kind).toBe("threw");
  });
  it("refuses an id or run that is not in the database's shape, before reading anything", async () => {
    asUser({ role: "ADMIN" });
    expect(await outcomeOf(() => call("a b"))).toEqual({ kind: "notFound" });
    expect(await outcomeOf(() => call("p-own", "x;drop"))).toEqual({ kind: "notFound" });
    expect(getStatement).not.toHaveBeenCalled();
  });
  it("is a 404 while the flag is off, and under the sample source", async () => {
    vi.stubEnv("PARTNER_WORKSPACE_ENABLED", "");
    asUser({ role: "ADMIN" });
    expect(await outcomeOf(() => call("p-own"))).toEqual({ kind: "notFound" });
    vi.stubEnv("PARTNER_WORKSPACE_ENABLED", "1");
    vi.stubEnv("PARTNER_SOURCE", "sample");
    expect(await outcomeOf(() => call("p-own"))).toEqual({ kind: "notFound" });
  });
});

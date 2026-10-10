import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Reading anything but through the workspace's own data layer would hit this and fail: draft runs must stay out of sight.
vi.mock("@/lib/db/prisma", () => ({ prisma: { partnerProfile: { findUnique: async () => ({ id: "p-own" }), findMany: async () => [] }, payout: new Proxy({}, { get() { throw new Error("read payouts directly"); } }) } }));
vi.mock("@/lib/policy/visibility", () => ({ getVisibleScope: vi.fn(async () => ({ partnerProfileIds: ["t1"] })) }));
const port = {
  getSummary: vi.fn(),
  getOverviewExtras: vi.fn(),
  listPayouts: vi.fn(),
};
const createNativePort = vi.fn((..._a: unknown[]) => port);
vi.mock("@/lib/partners/native/queries", async (orig) => ({ ...(await orig<object>()), createNativePort: (...a: unknown[]) => createNativePort(...a) }));

import { EarningsWidget } from "./earnings-widget";

const payoutRow = { id: "py1", runId: "r1", runStart: "2026-08-31T18:30:00.000Z", runEnd: "2026-09-30T18:30:00.000Z", runStatus: "APPROVED", partner: { id: "p1", code: "PTR-1", name: "A" }, accrued: "100", adjustment: "0", net: "100", status: "APPROVED", externalRef: null, reconciledAt: null, lines: 1, empanelment: "ACTIVE", bankVerified: true, bankLast4: "4321", statementHref: "" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PARTNER_WORKSPACE_ENABLED", "1");
  vi.stubEnv("PARTNER_SOURCE", "");
  port.getSummary.mockResolvedValue({ earnings: { total: 5000, lastMonth: 1000, lastMonthLabel: "Sep 2026" } });
  port.getOverviewExtras.mockResolvedValue({ accrualsThisMonth: { count: 2, amount: 250, label: "Oct 2026" }, pendingPayouts: { count: 1, amount: 900 }, hiddenRuns: 2, openRuns: null, tierMix: [] });
  port.listPayouts.mockResolvedValue({ items: [payoutRow], total: 1, limit: 5, offset: 0 });
});

const render = async (role: "PARTNER" | "DISTRIBUTOR" | "TEAM_MANAGER" = "PARTNER") => renderToStaticMarkup((await EarningsWidget({ actor: { id: "u1", role } })) as React.ReactElement);

describe("Partner Home earnings widget", () => {
  it("reads through the workspace's data layer, narrowed to the viewer's scope", async () => {
    await render("DISTRIBUTOR");
    expect(createNativePort).toHaveBeenCalledWith(expect.anything(), { kind: "ids", ids: ["p-own"], detailIds: ["p-own"] }, expect.anything());
    expect(port.listPayouts).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }));
  });
  it("shows the totals, the latest payouts and how many runs are awaiting approval, without listing them", async () => {
    const out = await render();
    expect(out).toContain("₹5,000");
    expect(out).toContain("₹900");
    expect(out).toContain("2 payout runs awaiting approval");
    expect(out).toContain("1 to 30 Sep 2026");
  });
  it("links into the workspace statements when the workspace is on, and not otherwise", async () => {
    expect(await render()).toContain('href="/partners/statements"');
    vi.stubEnv("PARTNER_WORKSPACE_ENABLED", "");
    expect(await render()).not.toContain("/partners/statements");
  });
  it("shows nothing when the viewer has no partner profile (never everything)", async () => {
    const { prisma } = await import("@/lib/db/prisma");
    vi.spyOn(prisma.partnerProfile, "findUnique").mockResolvedValueOnce(null as never);
    const out = await EarningsWidget({ actor: { id: "u1", role: "PARTNER" } });
    expect(out).toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const client = {
  id: "c1", name: "Asha Test", clientCode: "AV-1", status: "ACTIVE", priority: "MEDIUM", assignedToId: "rm-1", assignedTo: { name: "Rm One" }, createdAt: new Date("2026-09-01"),
  currentStage: { name: "New Lead", slaHours: 24 }, stageEnteredAt: new Date("2026-10-01"), leadSource: "Web", kycRecord: null, fundingRecord: null, dealerIntroduction: null,
  clientType: null, investmentCategory: null, productInterest: null, expectedInvestment: null, region: null, notes: null,
};
const rows: Record<string, unknown> = {
  "client.findUnique": client,
  "position.findMany": [{ productId: "p1", tradingAccountId: "a1", asOfDate: new Date("2026-10-01"), currentValue: 900, product: { name: "Secret Fund", category: "MUTUAL_FUND" } }],
  "transaction.findMany": [{ id: "t1", transactionType: "BUY", transactionDate: new Date("2026-10-02"), grossAmount: 12345, quantity: 3, price: 4115, product: { name: "Secret Stock" } }],
  "transaction.aggregate": { _max: { transactionDate: new Date("2026-10-02") } },
  "transaction.count": 4,
};
const model = (name: string) => new Proxy({}, {
  get: (_t, method: string) => async () => {
    calls.push(`${name}.${method}`);
    const key = `${name}.${method}`;
    if (key in rows) return rows[key];
    return method === "findMany" || method === "groupBy" ? [] : null;
  },
});
vi.mock("@/lib/db/prisma", () => ({ prisma: new Proxy({}, { get: (_t, name: string) => model(name) }) }));
vi.mock("@/lib/auth/visibility", () => ({ getVisibleUserIds: async () => null }));
vi.mock("@/lib/timeline/flag", () => ({ customerTimelineV2Enabled: () => false }));

import { buildClientFacts } from "./builders";

describe("buildClientFacts", () => {
  it("states name, total AUM, asset-class mix and last trading date, with no trade or holding detail", async () => {
    const { facts } = await buildClientFacts("c1", { id: "a", role: "ADMIN", name: "Admin" });
    expect(calls).not.toContain("transaction.findMany");
    for (const leak of ["Secret Stock", "Secret Fund", "12,345", "12345", "BUY"]) expect(facts).not.toContain(leak);
    expect(facts).toContain("last trading date 2 Oct 2026");
    expect(facts).toContain("₹900");
  });
});

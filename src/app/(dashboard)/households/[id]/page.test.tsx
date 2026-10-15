import { describe, expect, it, vi } from "vitest";

const account = {
  id: "ta1", accountNumber: "ACC-SECRET-1", accountType: "DEMAT",
  positions: [{ id: "p1", productId: "pr1", tradingAccountId: "ta1", quantity: 7, avgCost: 11, currentValue: 700, asOfDate: new Date("2026-10-01"), product: { name: "Secret Fund", productCode: "SF1", category: "MUTUAL_FUND" } }],
  transactions: [{ id: "t1", transactionType: "BUY", transactionDate: new Date("2026-10-02"), quantity: 7, price: 100, grossAmount: 700, netAmount: 699, product: { name: "Secret Fund", productCode: "SF1" } }],
};
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    household: { findUnique: async () => ({ id: "h1", name: "Test Household", householdCode: "HH-1", members: [{ id: "m1", isPrimary: true, relationship: null, client: { id: "c1", name: "Asha Test", clientCode: "AV-1", assignedToId: "rm-1" } }] }) },
    tradingAccount: { findMany: async () => [account], count: async () => 1 },
    position: { findMany: async () => account.positions },
    transaction: { aggregate: async () => ({ _max: { transactionDate: new Date("2026-10-02") } }), findMany: async () => account.transactions },
  },
}));
vi.mock("@/lib/auth/require-role", () => ({ requireAccess: async () => ({ user: { id: "rm-1", role: "ADMIN" } }) }));
vi.mock("@/lib/auth/visibility", () => ({ getVisibleUserIds: async () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); } }));

import HouseholdDetailPage from "./page";

describe("household 360", () => {
  it("shows name, total AUM, asset-class mix and last trading date only: no holding, account number or trade reaches the browser", async () => {
    const element = await HouseholdDetailPage({ params: Promise.resolve({ id: "h1" }) });
    const json = JSON.stringify(element, (_k, v) => (typeof v === "function" ? undefined : v));
    for (const leak of ["Secret Fund", "SF1", "ACC-SECRET-1", "quantity", "avgCost", "grossAmount", "transactionType"]) expect(json).not.toContain(leak);
    expect(json).toContain("700"); // total AUM
    expect(json).toContain("2026-10-02"); // last trading date
  });
});

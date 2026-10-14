import { describe, expect, it } from "vitest";

import { summarisePortfolio } from "./portfolio-aggregate";

const pos = (productId: string, accountId: string, value: number, category: "EQUITY" | "MUTUAL_FUND" | "BOND", day: number, name = `Secret ${productId}`) => ({
  productId,
  tradingAccountId: accountId,
  currentValue: value,
  asOfDate: new Date(Date.UTC(2026, 9, day)),
  product: { name, category },
});

describe("summarisePortfolio", () => {
  const out = summarisePortfolio({
    name: "Test Customer",
    positions: [pos("p1", "a1", 300, "EQUITY", 1), pos("p1", "a1", 600, "EQUITY", 5), pos("p2", "a1", 200, "MUTUAL_FUND", 5), pos("p3", "a2", 200, "BOND", 5)],
    lastTradingDate: new Date("2026-10-09T00:00:00Z"),
  });
  it("counts only the latest snapshot per holding", () => expect(out.totalAum).toBe(1000));
  it("gives the asset-class mix as percentages", () => {
    expect(out.mix).toEqual([
      { bucket: "Equity", pct: 60 },
      { bucket: "Mutual Fund", pct: 20 },
      { bucket: "Fixed Income", pct: 20 },
    ]);
  });
  it("gives only the last trading date", () => expect(out.lastTradingDate).toBe("2026-10-09T00:00:00.000Z"));
  it("carries no holding detail: no product, account or trade field in the serialized shape", () => {
    const json = JSON.stringify(out);
    for (const leak of ["Secret", "p1", "p2", "a1", "quantity", "price", "productId", "accountNumber"]) expect(json).not.toContain(leak);
    expect(Object.keys(out).sort()).toEqual(["asOf", "lastTradingDate", "mix", "name", "totalAum"]);
  });
  it("is empty and honest with no holdings", () => {
    const empty = summarisePortfolio({ name: "X", positions: [], lastTradingDate: null });
    expect(empty).toMatchObject({ totalAum: 0, mix: [], asOf: null, lastTradingDate: null });
  });
});

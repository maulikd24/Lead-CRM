import { describe, expect, it } from "vitest";

import { mapCustomerEntry, type MappedCustomer } from "./mapper";
import { writeCustomerRows } from "./write";
import { createMemoryRepo } from "./memory-repo";

const base = {
  customer: { clientCode: "CL-00001" },
  holdings: [{ accountNumber: "ACC-1", productCode: "SYN-MF-1", productName: "Synthetic Fund", category: "MUTUAL_FUND", quantity: 10, currentValue: 1000, asOfDate: "2026-10-08" }],
  transactions: [{ externalRef: "T-1", accountNumber: "ACC-1", productCode: "SYN-MF-1", type: "BUY", date: "2026-10-08T09:00:00Z", quantity: 1, price: 100, grossAmount: 100 }],
};
const mapped = (over: Record<string, unknown> = {}): Extract<MappedCustomer, { ok: true }> => {
  const r = mapCustomerEntry({ ...base, ...over });
  if (!r.ok) throw new Error("fixture invalid");
  return r;
};

describe("writeCustomerRows", () => {
  it("creates account, product, position and transaction on first delivery", async () => {
    const repo = createMemoryRepo();
    const out = await writeCustomerRows(repo, "client-1", mapped());
    expect(out.holdings).toEqual([{ index: 0, status: "created" }]);
    expect(out.transactions).toEqual([{ index: 0, status: "created" }]);
    expect(repo.state.accounts.size).toBe(1);
    expect(repo.state.products.size).toBe(1);
    expect(repo.state.positions.size).toBe(1);
    expect(repo.state.transactions.size).toBe(1);
  });

  it("is replay-safe: an identical delivery changes nothing", async () => {
    const repo = createMemoryRepo();
    await writeCustomerRows(repo, "client-1", mapped());
    const writesBefore = repo.state.writes;
    const out = await writeCustomerRows(repo, "client-1", mapped());
    expect(out.holdings).toEqual([{ index: 0, status: "unchanged" }]);
    expect(out.transactions).toEqual([{ index: 0, status: "unchanged" }]);
    expect(repo.state.writes).toBe(writesBefore);
    expect(repo.state.positions.size).toBe(1);
  });

  it("updates a corrected position and transaction in place", async () => {
    const repo = createMemoryRepo();
    await writeCustomerRows(repo, "client-1", mapped());
    const corrected = mapped({
      holdings: [{ ...base.holdings[0], currentValue: 1100 }],
      transactions: [{ ...base.transactions[0], grossAmount: 105 }],
    });
    const out = await writeCustomerRows(repo, "client-1", corrected);
    expect(out.holdings[0].status).toBe("updated");
    expect(out.transactions[0].status).toBe("updated");
    expect(repo.state.positions.size).toBe(1);
    expect([...repo.state.positions.values()][0].currentValue).toBe(1100);
  });

  it("keeps a new snapshot date as a separate position row (AUM trend)", async () => {
    const repo = createMemoryRepo();
    await writeCustomerRows(repo, "client-1", mapped());
    await writeCustomerRows(repo, "client-1", mapped({ holdings: [{ ...base.holdings[0], asOfDate: "2026-10-09" }] }));
    expect(repo.state.positions.size).toBe(2);
  });

  it("refuses an account that belongs to another customer, per row, without writing", async () => {
    const repo = createMemoryRepo();
    await writeCustomerRows(repo, "client-1", mapped());
    const out = await writeCustomerRows(repo, "client-2", mapped());
    expect(out.holdings).toEqual([{ index: 0, status: "failed", code: "ACCOUNT_OWNED_BY_OTHER_CUSTOMER" }]);
    expect(out.transactions).toEqual([{ index: 0, status: "failed", code: "ACCOUNT_OWNED_BY_OTHER_CUSTOMER" }]);
    expect(repo.state.positions.size).toBe(1);
  });

  it("refuses a transaction reference already used by another customer's account", async () => {
    const repo = createMemoryRepo();
    await writeCustomerRows(repo, "client-1", mapped());
    const out = await writeCustomerRows(repo, "client-2", mapped({ holdings: [], transactions: [{ ...base.transactions[0], accountNumber: "ACC-2" }] }));
    expect(out.transactions).toEqual([{ index: 0, status: "failed", code: "REFERENCE_OWNED_BY_OTHER_ACCOUNT" }]);
  });

  it("reports a failing row generically and continues with the rest", async () => {
    const repo = createMemoryRepo({ failOnPositionRef: "ACC-1-SYN-MF-1" });
    const out = await writeCustomerRows(repo, "client-1", mapped());
    expect(out.holdings).toEqual([{ index: 0, status: "failed", code: "WRITE_FAILED" }]);
    expect(out.transactions[0].status).toBe("created");
  });
});

import { describe, expect, it } from "vitest";

import { mapCustomerEntry, type MappedCustomer } from "./mapper";
import { createMemoryRepo } from "./memory-repo";
import { writeCustomerRows } from "./write";

const NOW = Date.parse("2026-10-09T00:00:00Z");
const base = {
  customer: { clientCode: "CL-00001" },
  holdings: [{ accountNumber: "ACC-1", productCode: "SYN-MF-1", productName: "Synthetic Fund", category: "MUTUAL_FUND", quantity: 10, currentValue: 1000, asOfDate: "2026-10-08", revision: 1 }],
  transactions: [{ externalRef: "T-1", accountNumber: "ACC-1", productCode: "SYN-MF-1", type: "BUY", date: "2026-10-08T09:00:00Z", quantity: 1, price: 100, grossAmount: 100, revision: 1 }],
};
const mapped = (over: Record<string, unknown> = {}): Extract<MappedCustomer, { ok: true }> => {
  const r = mapCustomerEntry({ ...base, ...over }, NOW);
  if (!r.ok) throw new Error("fixture invalid");
  return r;
};
const withH = (patch: Record<string, unknown>) => mapped({ holdings: [{ ...base.holdings[0], ...patch }], transactions: [] });
const withT = (patch: Record<string, unknown>) => mapped({ transactions: [{ ...base.transactions[0], ...patch }], holdings: [] });

describe("writeCustomerRows", () => {
  it("creates account, product, position and transaction on first delivery", async () => {
    const repo = createMemoryRepo();
    const out = await writeCustomerRows(repo, "client-1", mapped());
    expect(out.holdings).toEqual([{ index: 0, status: "created" }]);
    expect(out.transactions).toEqual([{ index: 0, status: "created" }]);
    expect([repo.state.accounts.size, repo.state.products.size, repo.state.positions.size, repo.state.transactions.size]).toEqual([1, 1, 1, 1]);
  });

  it("is replay-safe: an identical delivery changes nothing", async () => {
    const repo = createMemoryRepo();
    await writeCustomerRows(repo, "client-1", mapped());
    const before = repo.state.writes;
    const out = await writeCustomerRows(repo, "client-1", mapped());
    expect(out.holdings).toEqual([{ index: 0, status: "unchanged" }]);
    expect(out.transactions).toEqual([{ index: 0, status: "unchanged" }]);
    expect(repo.state.writes).toBe(before);
  });

  it("updates in place only for a strictly newer revision", async () => {
    const repo = createMemoryRepo();
    await writeCustomerRows(repo, "client-1", mapped());
    const out = await writeCustomerRows(repo, "client-1", mapped({ holdings: [{ ...base.holdings[0], currentValue: 1100, revision: 2 }], transactions: [{ ...base.transactions[0], grossAmount: 105, revision: 2 }] }));
    expect(out.holdings[0].status).toBe("updated");
    expect(out.transactions[0].status).toBe("updated");
    expect([...repo.state.positions.values()][0]).toMatchObject({ currentValue: "1100", revision: 2 });
    expect(repo.state.positions.size).toBe(1);
  });

  it("a late replay of an older revision cannot undo a correction (stale, nothing written)", async () => {
    const repo = createMemoryRepo();
    await writeCustomerRows(repo, "client-1", withH({ currentValue: 1100, revision: 2 }));
    await writeCustomerRows(repo, "client-1", withT({ grossAmount: 105, revision: 2 }));
    const before = repo.state.writes;
    const h = await writeCustomerRows(repo, "client-1", withH({ currentValue: 1000, revision: 1 }));
    const t = await writeCustomerRows(repo, "client-1", withT({ grossAmount: 100, revision: 1 }));
    expect(h.holdings).toEqual([{ index: 0, status: "stale" }]);
    expect(t.transactions).toEqual([{ index: 0, status: "stale" }]);
    expect(repo.state.writes).toBe(before);
    expect([...repo.state.positions.values()][0].currentValue).toBe("1100");
    expect([...repo.state.transactions.values()][0].grossAmount).toBe("105");
  });

  it("the same revision with different values is stale, not a silent overwrite", async () => {
    const repo = createMemoryRepo();
    await writeCustomerRows(repo, "client-1", withT({ revision: 3 }));
    const out = await writeCustomerRows(repo, "client-1", withT({ revision: 3, grossAmount: 999 }));
    expect(out.transactions[0].status).toBe("stale");
  });

  it("a newer revision with identical values is unchanged (no write)", async () => {
    const repo = createMemoryRepo();
    await writeCustomerRows(repo, "client-1", withH({ revision: 1 }));
    const before = repo.state.writes;
    const out = await writeCustomerRows(repo, "client-1", withH({ revision: 2 }));
    expect(out.holdings[0].status).toBe("unchanged");
    expect(repo.state.writes).toBe(before);
  });

  it("treats equal numbers written differently as the same value (canonical compare)", async () => {
    const repo = createMemoryRepo();
    await writeCustomerRows(repo, "client-1", withH({ quantity: "10.50" }));
    const out = await writeCustomerRows(repo, "client-1", withH({ quantity: 10.5 }));
    expect(out.holdings[0].status).toBe("unchanged");
  });

  it("a sold holding (closed) is written as zero and replaces the open row for that day", async () => {
    const repo = createMemoryRepo();
    await writeCustomerRows(repo, "client-1", withH({}));
    const { quantity: _q, currentValue: _v, ...rest } = base.holdings[0];
    void _q; void _v;
    await writeCustomerRows(repo, "client-1", mapped({ holdings: [{ ...rest, closed: true, revision: 2 }], transactions: [] }));
    expect([...repo.state.positions.values()][0]).toMatchObject({ quantity: "0", currentValue: "0" });
  });

  it("keeps a new snapshot date as a separate position row (AUM trend)", async () => {
    const repo = createMemoryRepo();
    await writeCustomerRows(repo, "client-1", mapped());
    await writeCustomerRows(repo, "client-1", withH({ asOfDate: "2026-10-09" }));
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

  it("refuses a transaction reference already used by another account", async () => {
    const repo = createMemoryRepo();
    await writeCustomerRows(repo, "client-1", mapped());
    const out = await writeCustomerRows(repo, "client-2", withT({ accountNumber: "ACC-2" }));
    expect(out.transactions).toEqual([{ index: 0, status: "failed", code: "REFERENCE_OWNED_BY_OTHER_ACCOUNT" }]);
  });

  it("the memory repo enforces unique keys like the database, so a duplicate create is a WRITE_FAILED row", async () => {
    const repo = createMemoryRepo();
    const first = mapped();
    await writeCustomerRows(repo, "client-1", first);
    // Simulates a concurrent delivery that created the row after this one's lookup.
    const racing = createMemoryRepo();
    await writeCustomerRows(racing, "client-1", first);
    const realFind = racing.findPositions;
    racing.findPositions = async () => new Map();
    const out = await writeCustomerRows(racing, "client-1", first);
    racing.findPositions = realFind;
    expect(out.holdings[0]).toEqual({ index: 0, status: "failed", code: "WRITE_FAILED" });
  });

  it("reports a failing row generically and continues with the rest", async () => {
    const repo = createMemoryRepo({ failOnPositionRef: "ACC-1-SYN-MF-1" });
    const out = await writeCustomerRows(repo, "client-1", mapped());
    expect(out.holdings).toEqual([{ index: 0, status: "failed", code: "WRITE_FAILED" }]);
    expect(out.transactions[0].status).toBe("created");
  });
});

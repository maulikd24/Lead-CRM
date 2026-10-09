import { describe, expect, it } from "vitest";

import { LIMITS, mapCustomerEntry, parseEnvelope } from "./mapper";

const customer = { clientCode: "CL-00001", pan: "abcde1234f", mobile: "+91 98765 43210", email: "Synthetic@Example.com" };
const holding = { accountNumber: "ACC-1", productCode: "SYN-MF-1", productName: "Synthetic Growth Fund", category: "MUTUAL_FUND", quantity: "10.5", currentValue: 12500.5, asOfDate: "2026-10-08" };
const txn = { externalRef: "T-1", accountNumber: "ACC-1", productCode: "SYN-MF-1", type: "BUY", date: "2026-10-08T09:15:00+05:30", quantity: 2, price: 100, grossAmount: 200 };

describe("parseEnvelope", () => {
  it("accepts a version 1 envelope", () => {
    expect(parseEnvelope({ version: 1, batchId: "b-1", customers: [{}] })).toMatchObject({ ok: true });
  });
  it.each([
    [null, "payload"],
    [[], "payload"],
    [{ version: 2, batchId: "b", customers: [] }, "version"],
    [{ version: 1, customers: [] }, "batchId"],
    [{ version: 1, batchId: "b!", customers: [] }, "batchId"],
    [{ version: 1, batchId: "b", customers: "x" }, "customers"],
  ])("rejects a bad envelope %#", (payload, field) => {
    const r = parseEnvelope(payload);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.path.startsWith(field))).toBe(true);
  });
  it("rejects more customers than the cap, and an empty batch", () => {
    expect(parseEnvelope({ version: 1, batchId: "b", customers: Array(LIMITS.customers + 1).fill({}) })).toMatchObject({ ok: false });
    expect(parseEnvelope({ version: 1, batchId: "b", customers: [] })).toMatchObject({ ok: false });
  });
  it("rejects a batch whose total rows exceed the cap", () => {
    const big = { customer, holdings: Array(LIMITS.rowsPerBatch).fill(holding), transactions: [txn] };
    expect(parseEnvelope({ version: 1, batchId: "b", customers: [big] })).toMatchObject({ ok: false });
  });
  it("never echoes submitted values in issues", () => {
    const r = parseEnvelope({ version: 1, batchId: "SECRET VALUE!", customers: [] });
    expect(JSON.stringify(r)).not.toContain("SECRET VALUE");
  });
});

describe("mapCustomerEntry", () => {
  it("normalises identifiers and rows", () => {
    const r = mapCustomerEntry({ customer, holdings: [holding], transactions: [txn] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.identity).toEqual({ clientCode: "CL-00001", pan: "ABCDE1234F", phoneKey: "9876543210", email: "synthetic@example.com" });
    expect(r.holdings[0]).toMatchObject({ index: 0, accountNumber: "ACC-1", productCode: "SYN-MF-1", category: "MUTUAL_FUND", quantity: 10.5, currentValue: 12500.5, externalRef: "ACC-1-SYN-MF-1" });
    expect(r.holdings[0].asOfDate.toISOString()).toBe("2026-10-08T00:00:00.000Z");
    expect(r.transactions[0]).toMatchObject({ index: 0, externalRef: "T-1", transactionType: "BUY", grossAmount: 200 });
    expect(r.transactions[0].transactionDate.toISOString()).toBe("2026-10-08T03:45:00.000Z");
  });
  it("requires at least one identifier", () => {
    expect(mapCustomerEntry({ customer: {}, holdings: [holding] })).toMatchObject({ ok: false, code: "NO_IDENTIFIER" });
    expect(mapCustomerEntry({ customer: { pan: "bad" }, holdings: [holding] })).toMatchObject({ ok: false, code: "NO_IDENTIFIER" });
  });
  it("rejects a non-object entry", () => {
    expect(mapCustomerEntry("x")).toMatchObject({ ok: false, code: "INVALID_ENTRY" });
  });
  it("keeps good rows and reports bad rows by index and code only", () => {
    const r = mapCustomerEntry({ customer, holdings: [holding, { ...holding, quantity: "abc" }, { ...holding, asOfDate: "nope" }, { ...holding, category: "WIDGET" }], transactions: [txn, { ...txn, type: "GIFT" }, { ...txn, externalRef: "" }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.holdings).toHaveLength(1);
    expect(r.transactions).toHaveLength(1);
    expect(r.rowErrors.map((e) => `${e.kind}[${e.index}]:${e.code}`)).toEqual([
      "holding[1]:INVALID_ROW", "holding[2]:INVALID_ROW", "holding[3]:INVALID_ROW", "transaction[1]:INVALID_ROW", "transaction[2]:INVALID_ROW",
    ]);
    expect(JSON.stringify(r.rowErrors)).not.toContain("abc");
  });
  it("rejects a future-dated transaction beyond clock skew and negative quantities", () => {
    const now = Date.parse("2026-10-09T00:00:00Z");
    const r = mapCustomerEntry({ customer, holdings: [{ ...holding, quantity: -1 }], transactions: [{ ...txn, date: "2027-01-01" }] }, now);
    expect(r.ok && r.holdings.length + r.transactions.length).toBe(0);
  });
  it("defaults the category to OTHER and a missing product name to the code", () => {
    const { category: _c, productName: _n, ...bare } = holding;
    void _c; void _n;
    const r = mapCustomerEntry({ customer, holdings: [bare] });
    expect(r.ok && r.holdings[0]).toMatchObject({ category: "OTHER", productName: "SYN-MF-1" });
  });
  it("uses the explicit externalRef for a holding when given", () => {
    const r = mapCustomerEntry({ customer, holdings: [{ ...holding, externalRef: "H-9" }] });
    expect(r.ok && r.holdings[0].externalRef).toBe("H-9");
  });
  it("rejects a customer with more rows than the per-customer cap", () => {
    const r = mapCustomerEntry({ customer, holdings: Array(LIMITS.rowsPerCustomer + 1).fill(holding) });
    expect(r).toMatchObject({ ok: false, code: "TOO_MANY_ROWS" });
  });
});

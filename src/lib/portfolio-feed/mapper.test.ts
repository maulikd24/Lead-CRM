import { describe, expect, it } from "vitest";

import { LIMITS, mapBatch, mapCustomerEntry, parseEnvelope } from "./mapper";

const NOW = Date.parse("2026-10-09T00:00:00Z");
const customer = { clientCode: "cl-00001", pan: "abcde1234f", mobile: "+91 98765 43210", email: "Synthetic@Example.com" };
const holding = { accountNumber: "ACC-1", productCode: "SYN-MF-1", productName: "Synthetic Growth Fund", category: "MUTUAL_FUND", quantity: "10.5", currentValue: 12500.5, asOfDate: "2026-10-08", revision: 1 };
const txn = { externalRef: "T-1", accountNumber: "ACC-1", productCode: "SYN-MF-1", type: "BUY", date: "2026-10-08T09:15:00+05:30", quantity: 2, price: 100, grossAmount: 200, revision: 1 };
const map = (entry: unknown, now = NOW) => mapCustomerEntry(entry, now);

describe("parseEnvelope", () => {
  it("accepts a version 1 envelope", () => expect(parseEnvelope({ version: 1, batchId: "b-1", customers: [{}] })).toMatchObject({ ok: true }));
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
    expect(parseEnvelope({ version: 1, batchId: "b", customers: [{ customer, holdings: Array(LIMITS.rowsPerBatch).fill(holding), transactions: [txn] }] })).toMatchObject({ ok: false });
  });
  it("never echoes submitted values in issues", () => {
    expect(JSON.stringify(parseEnvelope({ version: 1, batchId: "SECRET VALUE!", customers: [] }))).not.toContain("SECRET VALUE");
  });
});

describe("mapCustomerEntry: identity", () => {
  it("normalises identifiers and rows", () => {
    const r = map({ customer, holdings: [holding], transactions: [txn] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.identity).toEqual({ clientCode: "CL-00001", pan: "ABCDE1234F", phoneKey: "9876543210", email: "synthetic@example.com" });
    expect(r.holdings[0]).toMatchObject({ index: 0, accountNumber: "ACC-1", category: "MUTUAL_FUND", quantity: "10.5", currentValue: "12500.5", externalRef: "ACC-1-SYN-MF-1", revision: 1 });
    expect(r.holdings[0].asOfDate.toISOString()).toBe("2026-10-08T00:00:00.000Z");
    expect(r.transactions[0].transactionDate.toISOString()).toBe("2026-10-08T03:45:00.000Z");
  });
  it("accepts either strong id alone", () => {
    expect(map({ customer: { clientCode: "CL-1" } })).toMatchObject({ ok: true });
    expect(map({ customer: { pan: "ABCDE1234F" } })).toMatchObject({ ok: true });
  });
  it("refuses mobile or email alone: only clientCode or PAN may authorise a write", () => {
    expect(map({ customer: { mobile: "9876543210" }, holdings: [holding] })).toEqual({ ok: false, code: "NO_STRONG_ID" });
    expect(map({ customer: { email: "a@example.com" } })).toEqual({ ok: false, code: "NO_STRONG_ID" });
    expect(map({ customer: {} })).toEqual({ ok: false, code: "NO_STRONG_ID" });
  });
  it("refuses a malformed identifier instead of falling back to another one", () => {
    expect(map({ customer: { clientCode: "CL 1!", pan: "ABCDE1234F" } })).toEqual({ ok: false, code: "INVALID_IDENTIFIER" });
    expect(map({ customer: { pan: "bad", clientCode: "CL-1" } })).toEqual({ ok: false, code: "INVALID_IDENTIFIER" });
    expect(map({ customer: { clientCode: "CL-1", mobile: "123" } })).toEqual({ ok: false, code: "INVALID_IDENTIFIER" });
    expect(map({ customer: { clientCode: "CL-1", email: "nope" } })).toEqual({ ok: false, code: "INVALID_IDENTIFIER" });
  });
  it("rejects a non-object entry and too many rows", () => {
    expect(map("x")).toMatchObject({ ok: false, code: "INVALID_ENTRY" });
    expect(map({ customer, holdings: Array(LIMITS.rowsPerCustomer + 1).fill(holding) })).toMatchObject({ ok: false, code: "TOO_MANY_ROWS" });
  });
});

describe("mapCustomerEntry: rows", () => {
  it("keeps good rows and reports bad rows by position and field only", () => {
    const r = map({ customer, holdings: [holding, { ...holding, quantity: "abc" }, { ...holding, asOfDate: "nope" }, { ...holding, category: "WIDGET" }, { ...holding, revision: undefined }], transactions: [txn, { ...txn, type: "GIFT" }, { ...txn, externalRef: "" }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.holdings).toHaveLength(1);
    expect(r.transactions).toHaveLength(1);
    expect(r.rowErrors.map((e) => `${e.kind}[${e.index}]:${e.code}`)).toEqual(["holding[1]:INVALID_ROW", "holding[2]:INVALID_ROW", "holding[3]:INVALID_ROW", "holding[4]:INVALID_ROW", "transaction[1]:INVALID_ROW", "transaction[2]:INVALID_ROW"]);
    expect(JSON.stringify(r.rowErrors)).not.toContain("abc");
  });
  it("requires a revision on holdings and transactions", () => {
    const { revision: _a, ...h } = holding;
    const { revision: _b, ...t } = txn;
    void _a; void _b;
    const r = map({ customer, holdings: [h], transactions: [t] });
    expect(r.ok && r.holdings.length + r.transactions.length).toBe(0);
  });
  it("defaults category to OTHER and product name to the code; explicit externalRef wins", () => {
    const { category: _c, productName: _n, ...bare } = holding;
    void _c; void _n;
    expect(map({ customer, holdings: [bare] })).toMatchObject({ holdings: [{ category: "OTHER", productName: "SYN-MF-1" }] });
    expect(map({ customer, holdings: [{ ...holding, externalRef: "H-9" }] })).toMatchObject({ holdings: [{ externalRef: "H-9" }] });
  });
  it("a closed holding is stored as zero quantity and zero value, and needs no quantity", () => {
    const { quantity: _q, currentValue: _v, ...rest } = holding;
    void _q; void _v;
    expect(map({ customer, holdings: [{ ...rest, closed: true }] })).toMatchObject({ holdings: [{ quantity: "0", currentValue: "0" }] });
    expect(map({ customer, holdings: [rest] })).toMatchObject({ holdings: [], rowErrors: [{ code: "INVALID_ROW", fields: ["quantity"] }] });
  });
});

describe("mapCustomerEntry: bounds", () => {
  const bad = (h: Record<string, unknown>) => {
    const r = map({ customer, holdings: [{ ...holding, ...h }] });
    return r.ok ? r.holdings.length === 0 : true;
  };
  it("bounds asOfDate to 2000-01-01 .. now + 24h", () => {
    expect(bad({ asOfDate: "2099-01-01" })).toBe(true);
    expect(bad({ asOfDate: "1999-12-31" })).toBe(true);
    expect(bad({ asOfDate: "2026-10-09" })).toBe(false);
    expect(bad({ asOfDate: "2026-10-10" })).toBe(false); // within the 24h skew
    expect(bad({ asOfDate: "2026-10-11" })).toBe(true);
  });
  it("requires strict ISO 8601 dates", () => {
    for (const d of ["10/08/2026", "Oct 8 2026", "2026-10-08 09:00", "2026-10-08T09:00", "2026-02-31", "2026-13-01", "20261008", "2026-10-08T25:00:00Z"]) expect(bad({ asOfDate: d })).toBe(true);
    expect(bad({ asOfDate: "2026-10-08T09:00:00Z" })).toBe(false);
    expect(bad({ asOfDate: "2026-10-08T09:00:00+05:30" })).toBe(false);
  });
  it("applies the same rules to transaction dates", () => {
    const r = map({ customer, transactions: [{ ...txn, date: "2027-01-01" }, { ...txn, externalRef: "T-2", date: "1999-01-01" }, { ...txn, externalRef: "T-3", date: "08/10/2026" }] });
    expect(r.ok && r.transactions.length).toBe(0);
  });
  it("caps magnitude at 1e13 and decimals at 6", () => {
    expect(bad({ currentValue: 1e13 })).toBe(true);
    expect(bad({ currentValue: "9999999999999.999999" })).toBe(false);
    expect(bad({ currentValue: "1.1234567" })).toBe(true);
    expect(bad({ currentValue: 1e-7 })).toBe(true);
    expect(bad({ quantity: "1e5" })).toBe(true);
    expect(bad({ quantity: -1 })).toBe(true);
  });
  it("keeps numeric strings as exact strings (no float rounding)", () => {
    const r = map({ customer, holdings: [{ ...holding, quantity: "123456789012.123456", currentValue: "0.100000" }] });
    expect(r).toMatchObject({ holdings: [{ quantity: "123456789012.123456", currentValue: "0.1" }] });
  });
  it("lets transaction quantity and amounts be negative (reversals), but not price or brokerage", () => {
    expect(map({ customer, transactions: [{ ...txn, quantity: -2, grossAmount: "-200", netAmount: -199 }] })).toMatchObject({ transactions: [{ quantity: "-2", grossAmount: "-200", netAmount: "-199" }] });
    const r = map({ customer, transactions: [{ ...txn, price: -1 }, { ...txn, externalRef: "T-2", brokerage: -1 }] });
    expect(r.ok && r.transactions.length).toBe(0);
  });
});

describe("mapBatch: duplicate keys", () => {
  const entry = (code: string, extra: Record<string, unknown> = {}) => ({ customer: { clientCode: code }, holdings: [holding], transactions: [txn], ...extra });
  it("refuses every occurrence of a duplicate key inside one customer", () => {
    const r = mapBatch([{ customer, holdings: [holding, { ...holding, currentValue: 1 }], transactions: [txn, { ...txn, grossAmount: 5 }] }], NOW)[0];
    expect(r.ok && r.holdings).toEqual([]);
    expect(r.ok && r.transactions).toEqual([]);
    expect(r.ok && r.rowErrors.filter((e) => e.code === "DUPLICATE_KEY")).toHaveLength(4);
  });
  it("same holding key with a different asOfDate is not a duplicate", () => {
    const r = mapBatch([{ customer, holdings: [holding, { ...holding, asOfDate: "2026-10-07" }] }], NOW)[0];
    expect(r.ok && r.holdings).toHaveLength(2);
  });
  it("refuses a key repeated across customers, and an account claimed by two customers", () => {
    const [a, b] = mapBatch([entry("CL-1"), entry("CL-2")], NOW);
    expect(a.ok && a.holdings.length + a.transactions.length).toBe(0);
    expect(b.ok && b.holdings.length + b.transactions.length).toBe(0);
    const [c, d] = mapBatch([entry("CL-1", { holdings: [holding], transactions: [] }), entry("CL-2", { holdings: [{ ...holding, externalRef: "OTHER", asOfDate: "2026-10-07" }], transactions: [] })], NOW);
    expect(c.ok && c.holdings).toEqual([]);
    expect(d.ok && d.holdings).toEqual([]);
  });
  it("leaves unrelated customers alone", () => {
    const other = { customer: { clientCode: "CL-3" }, holdings: [{ ...holding, accountNumber: "ACC-9", productCode: "P9" }], transactions: [] };
    const [, o] = mapBatch([entry("CL-1"), other], NOW);
    expect(o.ok && o.holdings).toHaveLength(1);
  });
});

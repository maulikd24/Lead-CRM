import { describe, expect, it } from "vitest";

import { DEFAULT_MAPPING, kindForFileName, parseMapping } from "./mapping";

describe("parseMapping", () => {
  it("the default mapping is valid and uses the documented canonical column names", () => {
    const r = parseMapping(DEFAULT_MAPPING);
    expect(r.ok).toBe(true);
    expect(DEFAULT_MAPPING.holdings.accountNumber).toBe("accountNumber");
    expect(DEFAULT_MAPPING.dateFormat).toBe("iso");
    expect(DEFAULT_MAPPING.updatePolicy).toBe("fill_blank");
  });
  it("accepts renamed columns, a date format and value maps", () => {
    const r = parseMapping({ ...DEFAULT_MAPPING, dateFormat: "dmy", holdings: { ...DEFAULT_MAPPING.holdings, accountNumber: "Demat A/c No" }, valueMaps: { category: { equity: "EQUITY" }, type: { purchase: "BUY" } } });
    expect(r.ok && r.mapping.holdings.accountNumber).toBe("Demat A/c No");
    expect(r.ok && r.mapping.valueMaps.type).toEqual({ purchase: "BUY" });
  });
  it("rejects unknown keys, a bad date format, bad enum values and duplicated columns, with paths and codes only", () => {
    expect(parseMapping({ ...DEFAULT_MAPPING, extra: 1 }).ok).toBe(false);
    expect(parseMapping({ ...DEFAULT_MAPPING, dateFormat: "yyyy" }).ok).toBe(false);
    expect(parseMapping({ ...DEFAULT_MAPPING, valueMaps: { category: { x: "NOT_A_CATEGORY" }, type: {} } }).ok).toBe(false);
    const dup = parseMapping({ ...DEFAULT_MAPPING, holdings: { ...DEFAULT_MAPPING.holdings, productCode: "accountNumber" } });
    expect(dup).toEqual({ ok: false, issues: [{ path: "holdings", code: "duplicate_column" }] });
    expect(parseMapping("nope")).toEqual({ ok: false, issues: [{ path: "mapping", code: "not_an_object" }] });
  });
  it("requires at least one strong identifier column per kind", () => {
    const m = { ...DEFAULT_MAPPING, holdings: { ...DEFAULT_MAPPING.holdings, clientCode: undefined, pan: undefined } };
    expect(parseMapping(m)).toEqual({ ok: false, issues: [{ path: "holdings", code: "no_strong_identifier_column" }] });
  });
});

describe("kindForFileName", () => {
  it("routes by configurable prefix, case-insensitively, csv only", () => {
    expect(kindForFileName("Clients_2026-10-01.csv", DEFAULT_MAPPING)).toBe("CLIENTS");
    expect(kindForFileName("holdings-20261001.CSV", DEFAULT_MAPPING)).toBe("HOLDINGS");
    expect(kindForFileName("transactions.csv", DEFAULT_MAPPING)).toBe("TRANSACTIONS");
    expect(kindForFileName("other.csv", DEFAULT_MAPPING)).toBeNull();
    expect(kindForFileName("clients.txt", DEFAULT_MAPPING)).toBeNull();
    expect(kindForFileName("../clients.csv", DEFAULT_MAPPING)).toBeNull();
  });
});

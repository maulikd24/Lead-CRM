import { describe, expect, it } from "vitest";

import { parseCsv } from "./csv";
import { buildClientRows, buildFeedEntries } from "./build";
import { DEFAULT_MAPPING, type BackOfficeMapping } from "./mapping";

const csv = (text: string) => {
  const r = parseCsv(text);
  if (!r.ok) throw new Error("fixture");
  return r;
};

describe("buildFeedEntries (holdings)", () => {
  const head = "clientCode,pan,accountNumber,productCode,productName,quantity,currentValue,asOfDate";
  it("groups rows by customer into the portfolio-feed entry shape and remembers source lines", () => {
    const r = buildFeedEntries("HOLDINGS", csv(`${head}\nCL-00001,,ACC1,P1,Fund One,10,1000,2026-10-01\nCL-00001,,ACC1,P2,Fund Two,5,500,2026-10-01\nCL-00002,,ACC2,P1,Fund One,1,100,2026-10-01`), DEFAULT_MAPPING, { revision: 7 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0].entry).toMatchObject({ customer: { clientCode: "CL-00001" }, holdings: [{ accountNumber: "ACC1", productCode: "P1", quantity: "10", revision: 7 }, { productCode: "P2" }] });
    expect(r.entries[0].lines.holdings).toEqual([2, 3]);
    expect(r.entries[1].lines.holdings).toEqual([4]);
  });
  it("uses a revision column when mapped, else the run revision", () => {
    const m: BackOfficeMapping = { ...DEFAULT_MAPPING, holdings: { ...DEFAULT_MAPPING.holdings, revision: "ver" } };
    const r = buildFeedEntries("HOLDINGS", csv(`${head},ver\nCL-1,,A,P,N,1,1,2026-10-01,42`), m, { revision: 7 });
    expect(r.ok && (r.entries[0].entry.holdings as { revision: number }[])[0].revision).toBe(42);
    const bad = buildFeedEntries("HOLDINGS", csv(`${head},ver\nCL-1,,A,P,N,1,1,2026-10-01,abc`), m, { revision: 7 });
    expect(bad.ok && bad.lineErrors).toEqual([{ line: 2, code: "INVALID_ROW", fields: ["revision"] }]);
  });
  it("renames columns, converts dd/mm/yyyy dates and maps labels to enums", () => {
    const m: BackOfficeMapping = {
      ...DEFAULT_MAPPING,
      dateFormat: "dmy",
      holdings: { ...DEFAULT_MAPPING.holdings, accountNumber: "Demat No", asOfDate: "As On", category: "Asset Class" },
      valueMaps: { category: { "mutual fund": "MUTUAL_FUND" }, type: {} },
    };
    const r = buildFeedEntries("HOLDINGS", csv("clientCode,Demat No,productCode,quantity,As On,Asset Class\nCL-1,D1,P1,3,05/10/2026,Mutual Fund"), m, { revision: 1 });
    expect(r.ok && r.entries[0].entry.holdings).toMatchObject([{ accountNumber: "D1", asOfDate: "2026-10-05", category: "MUTUAL_FUND" }]);
  });
  it("matches headers case-insensitively", () => {
    const r = buildFeedEntries("HOLDINGS", csv("CLIENTCODE,ACCOUNTNUMBER,PRODUCTCODE,QUANTITY,ASOFDATE\nCL-1,A,P,1,2026-10-01"), DEFAULT_MAPPING, { revision: 1 });
    expect(r.ok).toBe(true);
  });
  it("fails the whole file when a required mapped column is missing, naming the config field only", () => {
    const r = buildFeedEntries("HOLDINGS", csv("clientCode,accountNumber\nCL-1,A"), DEFAULT_MAPPING, { revision: 1 });
    expect(r).toEqual({ ok: false, code: "MISSING_COLUMN", fields: ["productCode", "quantity", "asOfDate"] });
  });
  it("reports rows with no strong id, ragged rows, and treats closed flags", () => {
    const m: BackOfficeMapping = { ...DEFAULT_MAPPING, holdings: { ...DEFAULT_MAPPING.holdings, closed: "closed" } };
    const r = buildFeedEntries("HOLDINGS", csv(`${head},closed\n,,ACC1,P1,N,10,1,2026-10-01,\nCL-1,,ACC1,P1,N,,,2026-10-01,Y\nCL-1,,ACC1,P2,N,1,1,2026-10-01,n,extra`), m, { revision: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lineErrors).toEqual([{ line: 2, code: "NO_STRONG_ID", fields: [] }, { line: 4, code: "TOO_MANY_COLUMNS", fields: [] }]);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].entry.holdings).toMatchObject([{ productCode: "P1", closed: true }]);
  });
  it("does not leak cell values into errors", () => {
    const r = buildFeedEntries("HOLDINGS", csv(`${head},ver\n,,SECRET-ACC,P1,N,1,1,2026-10-01,1`), { ...DEFAULT_MAPPING, holdings: { ...DEFAULT_MAPPING.holdings, revision: "ver" } }, { revision: 1 });
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });
});

describe("buildFeedEntries (transactions)", () => {
  it("builds transaction entries with the type map applied", () => {
    const m: BackOfficeMapping = { ...DEFAULT_MAPPING, valueMaps: { category: {}, type: { purchase: "BUY" } } };
    const r = buildFeedEntries("TRANSACTIONS", csv("pan,externalRef,accountNumber,productCode,type,date,grossAmount,brokerage\nABCDE1234F,T1,A1,P1,Purchase,2026-10-01,-1000.50,2"), m, { revision: 3 });
    expect(r.ok && r.entries[0].entry).toMatchObject({ customer: { pan: "ABCDE1234F" }, transactions: [{ externalRef: "T1", type: "BUY", grossAmount: "-1000.50", brokerage: "2", revision: 3 }] });
  });
});

describe("buildClientRows", () => {
  it("returns identity plus profile fields per line", () => {
    const r = buildClientRows(csv("clientCode,pan,mobile,email,name,city\nCL-1,abcde1234f,98765 43210,a@example.com,Asha Rao,Pune\n,,,,No Id,X"), DEFAULT_MAPPING);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toEqual([{ line: 2, customer: { clientCode: "CL-1", pan: "abcde1234f", mobile: "98765 43210", email: "a@example.com" }, profile: { name: "Asha Rao", city: "Pune" } }]);
    expect(r.lineErrors).toEqual([{ line: 3, code: "NO_STRONG_ID", fields: [] }]);
  });
  it("fails when no identity column exists in the file", () => {
    expect(buildClientRows(csv("name\nA"), DEFAULT_MAPPING)).toEqual({ ok: false, code: "MISSING_COLUMN", fields: ["clientCode", "pan"] });
  });
});

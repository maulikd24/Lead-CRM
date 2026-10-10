import { describe, expect, it } from "vitest";

import { csvCell, csvRow, statementCsv, statementFilename } from "./csv";
import { buildStatement } from "./statement";

describe("csvCell", () => {
  it("leaves plain text alone", () => expect(csvCell("hello")).toBe("hello"));
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });
  it.each(["=SUM(A1)", "+1", "-1+2", "@cmd", "\tfoo", "\rfoo"])("neutralises a spreadsheet formula: %j", (v) => {
    const out = csvCell(v);
    expect(out.replace(/^"/, "")[0]).toBe("'");
  });
  it("does not damage a plain negative amount", () => expect(csvCell("-12.50", { number: true })).toBe("-12.50"));
  it("still neutralises a negative-looking text that is not marked as a number", () => {
    expect(csvCell("-12.50")).toBe("'-12.50");
  });
  it("handles null and undefined as empty", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("csvRow", () => {
  it("joins cells with commas", () => expect(csvRow(["a", "b,c", "d"])).toBe('a,"b,c",d'));
});

describe("statementCsv", () => {
  const statement = buildStatement({
    lines: [{ id: "1", date: "2026-09-05T00:00:00.000Z", revenueType: "BROKERAGE", clientCode: "CL-00001", amount: "100.004" }],
    adjustments: [{ id: "2", date: "2026-09-20T00:00:00.000Z", reason: "=HYPERLINK(\"x\")", amount: "-10" }],
    stored: null,
  });
  const csv = statementCsv({ partnerCode: "PTR-00001", partnerName: "A, B Associates", periodLabel: "1 Sep 2026 to 30 Sep 2026", runStatus: "FINALIZED", payoutStatus: "APPROVED", bankLast4: "1234", statement });
  const rows = csv.replace(/^﻿/, "").split("\r\n").filter(Boolean);

  it("starts with a byte-order mark so a spreadsheet reads it as UTF-8", () => expect(csv.startsWith("﻿")).toBe(true));
  it("uses CRLF line ends", () => expect(csv).toContain("\r\n"));
  it("has a header row and one row per line, adjustment and total", () => {
    expect(rows[0]).toBe("Type,Date,Reference,Description,Amount (INR)");
    expect(rows.some((r) => r.startsWith("Accrual,2026-09-05,CL-00001,Brokerage,100.00"))).toBe(true);
    expect(rows.some((r) => r.startsWith("Adjustment,2026-09-20"))).toBe(true);
    for (const label of ["Total accruals", "Rounding", "Adjustments", "Net payable"]) expect(rows.some((r) => r.startsWith(`Total,,,${label}`))).toBe(true);
  });
  it("never carries more of the bank account than the last four digits", () => {
    expect(csv).toContain("••••1234".replace(/•/g, "*"));
    expect(csv).not.toMatch(/\d{9,}/);
  });
  it("neutralises a formula hidden in an adjustment reason", () => {
    expect(csv).not.toMatch(/,=HYPERLINK/);
    expect(csv).toContain("'=HYPERLINK");
  });
  it("quotes a partner name that holds a comma", () => expect(csv).toContain('"A, B Associates"'));
  it("states that tax is not computed", () => expect(csv).toMatch(/TDS/));
});

describe("statementFilename", () => {
  it("is safe and predictable", () => {
    expect(statementFilename("PTR-00001", "2026-09")).toBe("statement-PTR-00001-2026-09.csv");
  });
  it("strips anything that could escape a header or a path", () => {
    expect(statementFilename('PTR/../"x"\r\n', "2026 09")).toBe("statement-PTR-x-2026-09.csv");
  });
});

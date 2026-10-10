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
    for (const label of ["Total accruals", "Rounding", "Adjustments", "Net before tax", "Payable"]) expect(rows.some((r) => r.startsWith(`Total,,,${label}`))).toBe(true);
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
  it("with no tax rules it says so and deducts nothing", () => {
    expect(csv).toMatch(/No tax rules (are )?configured/i);
    expect(csv).toContain("Tax rules are configured by Finance. Confirm with your tax adviser.");
    expect(rows.some((r) => r.startsWith("Total,,,Payable"))).toBe(true);
  });
});

describe("statementCsv with tax rules", () => {
  const rule = { id: "t1", kind: "TDS" as const, label: "Section X", ratePercent: "10", thresholdAmount: "1000", partnerTypes: [], panStatus: "ANY" as const, gstRegistration: "ANY" as const, gstMode: null, effectiveFrom: "2026-04-01T00:00:00.000Z", effectiveTo: null };
  const gst = { ...rule, id: "g1", kind: "GST" as const, label: "GST", ratePercent: "18", thresholdAmount: null, gstMode: "REVERSE_CHARGE" as const };
  const statement = buildStatement({
    lines: [{ id: "1", date: "2026-09-05T00:00:00.000Z", revenueType: "BROKERAGE", clientCode: "CL-00001", amount: "2000" }],
    adjustments: [],
    stored: null,
    tax: { rules: [rule, gst], facts: { partnerType: "PARTNER", hasPan: true, hasGstin: false }, at: "2026-09-30T00:00:00.000Z", priorBase: "0" },
  });
  const csv = statementCsv({ partnerCode: "PTR-00001", partnerName: "A", periodLabel: "Sep 2026", runStatus: "FINALIZED", payoutStatus: "APPROVED", bankLast4: null, statement });
  const rows = csv.replace(/^﻿/, "").split("\r\n").filter(Boolean);
  it("prints each tax line with its rule, signed effect and the payable after tax", () => {
    expect(rows.some((r) => r.startsWith("Tax,,,") && r.includes("Section X") && r.endsWith("-200.00"))).toBe(true);
    expect(rows.some((r) => r.startsWith("Tax,,,") && r.includes("GST") && r.includes("not deducted"))).toBe(true);
    expect(rows.some((r) => r.startsWith("Total,,,Payable") && r.endsWith("1800.00"))).toBe(true);
  });
  it("prints the exact rule, the rounding rule and the note", () => {
    expect(rows.some((r) => r.startsWith("Note,,,") && r.includes("Section X: 10%"))).toBe(true);
    expect(csv).toMatch(/nearest paisa/i);
    expect(csv).toContain("Confirm with your tax adviser.");
  });
});

describe("statementFilename", () => {
  it("is safe and predictable", () => {
    expect(statementFilename("PTR-00001", "2026-09")).toBe("statement-PTR-00001-2026-09.csv");
  });
  it("strips anything that could escape a header or a path", () => {
    expect(statementFilename('PTR/../"x"\r\n', "2026 09")).toBe("statement-PTR-x-2026-09.csv");
  });
});


describe("statementCsv: letterhead, totals only and the year to date", () => {
  const base = { partnerCode: "PTR-00001", partnerName: "A", periodLabel: "Sep 2026", runStatus: "OPEN", payoutStatus: "ESTIMATE", bankLast4: null };
  const statement = buildStatement({ lines: [{ id: "1", date: "2026-09-05T00:00:00.000Z", revenueType: "BROKERAGE", clientCode: "CL-00001", amount: "100" }], adjustments: [], stored: null });
  const rowsOf = (csv: string) => csv.replace(/^﻿/, "").split("\r\n").filter(Boolean);

  it("prints the letterhead and registration text from Settings above the figures", () => {
    const rows = rowsOf(statementCsv({ ...base, statement, branding: { letterhead: ["Firm Name", "Town"], registration: "Registered no. 123" } }));
    expect(rows.slice(1, 4)).toEqual(["Info,,Firm Name,Issued by,", "Info,,Town,Issued by,", "Info,,Registered no. 123,Registration,"]);
  });
  it("prints nothing about the issuer when none is configured", () => {
    expect(statementCsv({ ...base, statement })).not.toMatch(/Issued by/);
  });
  it("totals only: no accrual or adjustment row, and it says so", () => {
    const csv = statementCsv({ ...base, statement, hideLines: true });
    const rows = rowsOf(csv);
    expect(rows.some((r) => r.startsWith("Accrual,"))).toBe(false);
    expect(rows.some((r) => r.startsWith("Adjustment,"))).toBe(false);
    expect(rows.some((r) => r.startsWith("Total,,,Total accruals"))).toBe(true);
    expect(csv).toMatch(/totals only/i);
    expect(csv).not.toContain("CL-00001");
  });
  it("names the statement type", () => {
    expect(rowsOf(statementCsv({ ...base, statement, kindLabel: "Calendar month" })).some((r) => r === "Info,,Calendar month,Statement type,")).toBe(true);
  });
  it("the year to date is a month by month table with the tax carried, then the totals", () => {
    const cumulative = { rows: [{ month: "2026-04", accruals: "600.00", adjustments: "0.00", base: "600.00", running: "600.00", tds: "0.00", gst: "0.00", gstMemo: false }, { month: "2026-05", accruals: "600.00", adjustments: "0.00", base: "600.00", running: "1200.00", tds: "120.00", gst: "0.00", gstMemo: false }], totals: { base: "1200.00", tds: "120.00", gst: "0.00" }, taxState: "applied" as const };
    const rows = rowsOf(statementCsv({ ...base, statement, hideLines: true, cumulative }));
    expect(rows).toContain("Month,2026-04,,Earned 600.00; adjustments 0.00; running total 600.00; TDS 0.00; GST 0.00,600.00");
    expect(rows).toContain("Month,2026-05,,Earned 600.00; adjustments 0.00; running total 1200.00; TDS 120.00; GST 0.00,600.00");
    expect(rows).toContain("Total,,,Earned in the period,1200.00");
    expect(rows).toContain("Total,,,TDS for the period,120.00");
    expect(rows.some((r) => r.startsWith("Total,,,Total accruals"))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { CSV_LIMITS, parseCsv } from "./csv";

describe("parseCsv", () => {
  it("parses a header and rows, trimming header cells and stripping a BOM", () => {
    const r = parseCsv("﻿ code , name\r\nA1,Asha\r\nB2,Bala\r\n");
    expect(r).toEqual({ ok: true, header: ["code", "name"], rows: [{ line: 2, cells: ["A1", "Asha"] }, { line: 3, cells: ["B2", "Bala"] }] });
  });
  it("handles quotes, embedded commas, escaped quotes and embedded newlines, tracking physical line numbers", () => {
    const r = parseCsv('a,b\n"x,1","he said ""hi"""\n"multi\nline",z\nlast,row');
    expect(r.ok && r.rows.map((x) => x.cells)).toEqual([["x,1", 'he said "hi"'], ["multi\nline", "z"], ["last", "row"]]);
    expect(r.ok && r.rows.map((x) => x.line)).toEqual([2, 3, 5]);
  });
  it("skips blank lines and pads/refuses ragged rows", () => {
    const r = parseCsv("a,b\n\n1,2\n3\n");
    expect(r.ok && r.rows).toEqual([{ line: 3, cells: ["1", "2"] }, { line: 4, cells: ["3", ""] }]);
    const wide = parseCsv("a,b\n1,2,3\n");
    expect(wide.ok && wide.rows[0].tooWide).toBe(true);
  });
  it("rejects an empty file, a duplicate header, and an unterminated quote", () => {
    expect(parseCsv("")).toEqual({ ok: false, code: "EMPTY" });
    expect(parseCsv("a,a\n1,2")).toEqual({ ok: false, code: "DUPLICATE_HEADER" });
    expect(parseCsv('a,b\n"oops,1')).toEqual({ ok: false, code: "UNTERMINATED_QUOTE" });
  });
  it("enforces size, row, column and field limits", () => {
    expect(parseCsv("a\n" + "x".repeat(20), { ...CSV_LIMITS, maxBytes: 10 })).toEqual({ ok: false, code: "TOO_LARGE" });
    expect(parseCsv("a\n1\n2\n3\n", { ...CSV_LIMITS, maxRows: 2 })).toEqual({ ok: false, code: "TOO_MANY_ROWS" });
    expect(parseCsv("a,b,c\n1,2,3", { ...CSV_LIMITS, maxColumns: 2 })).toEqual({ ok: false, code: "TOO_MANY_COLUMNS" });
    expect(parseCsv("a\n" + "x".repeat(50), { ...CSV_LIMITS, maxFieldLength: 10 })).toEqual({ ok: false, code: "FIELD_TOO_LONG" });
  });
  it("never echoes file content in a failure", () => {
    expect(JSON.stringify(parseCsv("secret,secret\n1,2"))).not.toContain("secret");
  });
});

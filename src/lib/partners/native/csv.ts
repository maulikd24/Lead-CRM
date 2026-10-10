import { istDay, words } from "./format";
import type { Statement } from "./statement";

/** One CSV cell. Text that a spreadsheet could read as a formula gets a leading apostrophe; `number` marks a plain amount, which is left alone. */
export function csvCell(value: string | null | undefined, opts: { number?: boolean } = {}): string {
  if (value === null || value === undefined) return "";
  let v = String(value);
  if (!(opts.number && /^-?\d+(\.\d+)?$/.test(v)) && /^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export const csvRow = (cells: (string | null | undefined)[]): string => cells.map((c) => csvCell(c)).join(",");

export type StatementCsvInput = {
  partnerCode: string;
  partnerName: string;
  periodLabel: string;
  runStatus: string;
  payoutStatus: string;
  /** Only ever the last four digits. Null when no bank account is on file. */
  bankLast4: string | null;
  statement: Statement;
};

/** A statement as CSV: one table, a Type column telling info, accrual, adjustment, total and note rows apart. UTF-8 with a byte-order mark; CRLF. */
export function statementCsv(i: StatementCsvInput): string {
  const s = i.statement;
  const out: string[] = [csvRow(["Type", "Date", "Reference", "Description", "Amount (INR)"])];
  const info = (label: string, value: string) => out.push(csvRow(["Info", "", value, label, ""]));
  info("Partner code", i.partnerCode);
  info("Partner name", i.partnerName);
  info("Period", i.periodLabel);
  info("Payout run status", words(i.runStatus));
  info("Payout status", words(i.payoutStatus));
  info("Bank account", i.bankLast4 ? `****${i.bankLast4.slice(-4)}` : "Not on file");
  for (const l of s.lines) out.push([csvCell("Accrual"), csvCell(istDay(l.date)), csvCell(l.clientCode), csvCell(words(l.revenueType)), csvCell(l.amount, { number: true })].join(","));
  for (const a of s.adjustments) out.push([csvCell("Adjustment"), csvCell(istDay(a.date)), "", csvCell(a.reason), csvCell(a.amount, { number: true })].join(","));
  const total = (label: string, amount: string) => out.push(["Total", "", "", csvCell(label), csvCell(amount, { number: true })].join(","));
  total("Total accruals", s.gross);
  total("Rounding", s.rounding);
  total("Adjustments", s.adjustmentsTotal);
  total("Net payable", s.net);
  for (const note of s.assumptions) out.push(["Note", "", "", csvCell(note), ""].join(","));
  return `﻿${out.join("\r\n")}\r\n`;
}

/** statement-<code>-<period>.csv, with anything outside letters, digits and dashes removed so it cannot escape a header or a path. */
export function statementFilename(partnerCode: string, period: string): string {
  const clean = (v: string) => v.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `statement-${clean(partnerCode)}-${clean(period)}.csv`;
}

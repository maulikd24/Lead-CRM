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
  total("Net before tax", s.net);
  for (const t of s.tax.lines) {
    const detail = t.kind === "TDS" ? `${t.label} ${t.rate} on year-to-date ${t.running ?? t.base} (this statement ${t.base})` : `${t.label} ${t.rate} on ${t.base} = ${t.amount}${t.memo ? " (shown, not deducted from you)" : " (added, you invoice it)"}`;
    out.push(["Tax", "", "", csvCell(detail), csvCell(t.effect, { number: true })].join(","));
  }
  total("Payable", s.payable);
  for (const note of s.assumptions) out.push(["Note", "", "", csvCell(note), ""].join(","));
  if (s.tax.state === "not_configured") out.push(["Note", "", "", csvCell("No tax rules configured: nothing is deducted."), ""].join(","));
  if (s.tax.state === "no_match") out.push(["Note", "", "", csvCell("Tax rules exist but none applies to this partner: nothing is deducted."), ""].join(","));
  if (s.tax.state === "conflict") out.push(["Note", "", "", csvCell("Two tax rules conflict for this partner: nothing is deducted for that tax until Finance resolves it."), ""].join(","));
  for (const t of s.tax.lines) out.push(["Note", "", "", csvCell(`Rule used: ${t.ruleText}`), ""].join(","));
  out.push(["Note", "", "", csvCell(s.tax.rounding), ""].join(","));
  out.push(["Note", "", "", csvCell(s.tax.note), ""].join(","));
  return `﻿${out.join("\r\n")}\r\n`;
}

/** statement-<code>-<period>.csv, with anything outside letters, digits and dashes removed so it cannot escape a header or a path. */
export function statementFilename(partnerCode: string, period: string): string {
  const clean = (v: string) => v.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `statement-${clean(partnerCode)}-${clean(period)}.csv`;
}

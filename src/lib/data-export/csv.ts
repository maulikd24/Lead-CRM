import Papa from "papaparse";

const EXCEL_CELL_LIMIT = 30_000;

/** Neutralises spreadsheet formula injection and Excel's cell-size limit; objects become compact JSON. */
export function safeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (text.length > EXCEL_CELL_LIMIT) text = `${text.slice(0, EXCEL_CELL_LIMIT)}… [truncated — full text is in data/*.ndjson]`;
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/** One CSV chunk. Pass `header: true` only for the first chunk of a file. */
export function toCsv(columns: string[], rows: Record<string, unknown>[], header: boolean): string {
  const data = rows.map((row) => columns.map((column) => safeCell(row[column])));
  const text = Papa.unparse(header ? { fields: columns, data } : data, { newline: "\n" }).replace(/\n+$/, "");
  return text ? `${text}\n` : "";
}

import type { CsvRow } from "./csv";
import type { BackOfficeMapping, FileKind } from "./mapping";

/**
 * Turns parsed CSV rows into the portfolio-feed's own customer-entry shape ({ customer, holdings, transactions }),
 * so validation, matching and writing stay in src/lib/portfolio-feed. This module only renames columns, converts
 * date notation and value labels, and groups rows by customer. Row problems are reported by physical line number,
 * a short code and config field names: never cell values.
 */

export type LineError = { line: number; code: string; fields: string[] };
export type BuiltEntry = {
  entry: { customer: Record<string, string>; holdings?: Record<string, unknown>[]; transactions?: Record<string, unknown>[] };
  /** Source line of each row, aligned with entry.holdings / entry.transactions. */
  lines: { holdings: number[]; transactions: number[] };
};
export type BuildFailure = { ok: false; code: "MISSING_COLUMN"; fields: string[] };
type Csv = { header: string[]; rows: CsvRow[] };
type Cols = Record<string, string | undefined>;

const IDENTITY = ["clientCode", "pan", "mobile", "email"] as const;
const REQUIRED: Record<"HOLDINGS" | "TRANSACTIONS", string[]> = {
  HOLDINGS: ["accountNumber", "productCode", "quantity", "asOfDate"],
  TRANSACTIONS: ["externalRef", "accountNumber", "type", "date", "grossAmount"],
};

/** field name to column index (or -1 when the mapped header is absent from this file). */
function resolveColumns(header: string[], cols: Cols): Record<string, number> {
  const index = new Map(header.map((h, i) => [h.toLowerCase(), i]));
  return Object.fromEntries(Object.entries(cols).flatMap(([field, name]) => (name ? [[field, index.get(name.toLowerCase()) ?? -1] as const] : [])));
}
const cell = (row: CsvRow, at: Record<string, number>, field: string): string => {
  const i = at[field];
  return i === undefined || i < 0 ? "" : row.cells[i].trim();
};
const missingIdentity = (at: Record<string, number>): string[] | null => {
  const mapped = IDENTITY.filter((f) => f in at);
  const strongPresent = (at.clientCode ?? -1) >= 0 || (at.pan ?? -1) >= 0;
  return strongPresent ? null : mapped.filter((f) => f === "clientCode" || f === "pan");
};

const DMY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;
/** Converts the configured notation to ISO yyyy-mm-dd. Anything else passes through for the portfolio-feed validator to refuse. */
export function toIsoDate(raw: string, format: BackOfficeMapping["dateFormat"]): string {
  if (format === "iso") return raw;
  const m = DMY.exec(raw);
  if (!m) return raw;
  const [day, month] = format === "dmy" ? [m[1], m[2]] : [m[2], m[1]];
  return `${m[3]}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

const TRUE = new Set(["y", "yes", "true", "1", "closed"]);
const lookup = (map: Record<string, string>, raw: string) => map[raw.toLowerCase()] ?? raw;

function identityOf(row: CsvRow, at: Record<string, number>): Record<string, string> {
  const customer: Record<string, string> = {};
  for (const f of IDENTITY) {
    const v = cell(row, at, f);
    if (v) customer[f] = v;
  }
  return customer;
}
const hasStrong = (c: Record<string, string>) => Boolean(c.clientCode || c.pan);

export function buildFeedEntries(kind: "HOLDINGS" | "TRANSACTIONS", csv: Csv, mapping: BackOfficeMapping, opts: { revision: number }):
  | { ok: true; entries: BuiltEntry[]; lineErrors: LineError[]; rowCount: number }
  | BuildFailure {
  const cols: Cols = kind === "HOLDINGS" ? mapping.holdings : mapping.transactions;
  const at = resolveColumns(csv.header, cols);
  const missing = REQUIRED[kind].filter((f) => !((at[f] ?? -1) >= 0));
  const identityMissing = missingIdentity(at);
  if (missing.length || identityMissing) return { ok: false, code: "MISSING_COLUMN", fields: [...(identityMissing ?? []), ...missing] };

  const lineErrors: LineError[] = [];
  const groups = new Map<string, BuiltEntry>();
  const key = (c: Record<string, string>) => `${c.clientCode ?? ""}|${c.pan ?? ""}|${c.mobile ?? ""}|${c.email ?? ""}`;

  for (const row of csv.rows) {
    if (row.tooWide) {
      lineErrors.push({ line: row.line, code: "TOO_MANY_COLUMNS", fields: [] });
      continue;
    }
    const customer = identityOf(row, at);
    if (!hasStrong(customer)) {
      lineErrors.push({ line: row.line, code: "NO_STRONG_ID", fields: [] });
      continue;
    }
    const revisionText = cell(row, at, "revision");
    let revision = opts.revision;
    if (revisionText) {
      if (!/^\d{1,10}$/.test(revisionText) || Number(revisionText) > 2_000_000_000) {
        lineErrors.push({ line: row.line, code: "INVALID_ROW", fields: ["revision"] });
        continue;
      }
      revision = Number(revisionText);
    }
    const optional = (field: string) => {
      const v = cell(row, at, field);
      return v === "" ? {} : { [field]: v };
    };

    let built: Record<string, unknown>;
    if (kind === "HOLDINGS") {
      const closed = cell(row, at, "closed");
      built = {
        accountNumber: cell(row, at, "accountNumber"),
        productCode: cell(row, at, "productCode"),
        ...optional("productName"),
        ...(cell(row, at, "category") ? { category: lookup(mapping.valueMaps.category, cell(row, at, "category")) } : {}),
        ...optional("isin"),
        ...optional("quantity"),
        ...optional("avgCost"),
        ...optional("currentValue"),
        ...(closed ? { closed: TRUE.has(closed.toLowerCase()) } : {}),
        asOfDate: toIsoDate(cell(row, at, "asOfDate"), mapping.dateFormat),
        revision,
        ...optional("externalRef"),
      };
    } else {
      built = {
        externalRef: cell(row, at, "externalRef"),
        accountNumber: cell(row, at, "accountNumber"),
        ...optional("productCode"),
        type: lookup(mapping.valueMaps.type, cell(row, at, "type")),
        date: toIsoDate(cell(row, at, "date"), mapping.dateFormat),
        ...(cell(row, at, "settlementDate") ? { settlementDate: toIsoDate(cell(row, at, "settlementDate"), mapping.dateFormat) } : {}),
        ...optional("quantity"),
        ...optional("price"),
        grossAmount: cell(row, at, "grossAmount"),
        ...optional("netAmount"),
        ...optional("brokerage"),
        revision,
      };
    }

    const k = key(customer);
    let group = groups.get(k);
    if (!group) {
      group = { entry: { customer, ...(kind === "HOLDINGS" ? { holdings: [] } : { transactions: [] }) }, lines: { holdings: [], transactions: [] } };
      groups.set(k, group);
    }
    const bucket = kind === "HOLDINGS" ? "holdings" : "transactions";
    group.entry[bucket]!.push(built);
    group.lines[bucket].push(row.line);
  }
  return { ok: true, entries: [...groups.values()], lineErrors, rowCount: csv.rows.length };
}

export type ClientRow = { line: number; customer: Record<string, string>; profile: Record<string, string> };
const PROFILE = ["name", "city", "state", "clientType", "investmentCategory"] as const;

export function buildClientRows(csv: Csv, mapping: BackOfficeMapping): { ok: true; rows: ClientRow[]; lineErrors: LineError[]; rowCount: number } | BuildFailure {
  const at = resolveColumns(csv.header, mapping.clients);
  const identityMissing = missingIdentity(at);
  if (identityMissing) return { ok: false, code: "MISSING_COLUMN", fields: identityMissing };
  const rows: ClientRow[] = [];
  const lineErrors: LineError[] = [];
  for (const row of csv.rows) {
    if (row.tooWide) {
      lineErrors.push({ line: row.line, code: "TOO_MANY_COLUMNS", fields: [] });
      continue;
    }
    const customer = identityOf(row, at);
    if (!hasStrong(customer)) {
      lineErrors.push({ line: row.line, code: "NO_STRONG_ID", fields: [] });
      continue;
    }
    const profile: Record<string, string> = {};
    for (const f of PROFILE) {
      const v = cell(row, at, f);
      if (v) profile[f] = v;
    }
    rows.push({ line: row.line, customer, profile });
  }
  return { ok: true, rows, lineErrors, rowCount: csv.rows.length };
}

export type { FileKind };

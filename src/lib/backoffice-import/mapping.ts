import { z } from "zod";

import { PRODUCT_CATEGORIES, TRANSACTION_TYPES } from "@/lib/portfolio-feed/mapper";

/**
 * Column-mapping config for the back-office importer. Stored in Settings (BackOfficeImportConfig), never hard-coded:
 * each canonical field names the CSV header that carries it (matched case-insensitively). An unset field means
 * "this file has no such column". The default maps every field to its own canonical name, i.e. the documented contract.
 */

const col = z.string().trim().min(1).max(80).optional();

const identityFields = { clientCode: col, pan: col, mobile: col, email: col };

const clientsSchema = z.object({ ...identityFields, name: col, city: col, state: col, clientType: col, investmentCategory: col }).strict();
const holdingsSchema = z
  .object({ ...identityFields, accountNumber: col, productCode: col, productName: col, category: col, isin: col, quantity: col, avgCost: col, currentValue: col, closed: col, asOfDate: col, revision: col, externalRef: col })
  .strict();
const transactionsSchema = z
  .object({ ...identityFields, externalRef: col, accountNumber: col, productCode: col, type: col, date: col, settlementDate: col, quantity: col, price: col, grossAmount: col, netAmount: col, brokerage: col, revision: col })
  .strict();

const valueMap = <T extends readonly [string, ...string[]]>(values: T) => z.record(z.string().trim().min(1).max(80), z.enum(values));
const prefix = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/);

export const mappingSchema = z
  .object({
    version: z.literal(1),
    /** How date cells are written in the files. */
    dateFormat: z.enum(["iso", "dmy", "mdy"]).default("iso"),
    /** fill_blank: only empty client fields are filled. overwrite: name, city, state, type and category are replaced; email and mobile (match keys) are still only ever filled. */
    updatePolicy: z.enum(["fill_blank", "overwrite"]).default("fill_blank"),
    filePrefixes: z.object({ clients: prefix, holdings: prefix, transactions: prefix }).strict(),
    clients: clientsSchema,
    holdings: holdingsSchema,
    transactions: transactionsSchema,
    /** Back-office labels (lower-cased) to our enums, e.g. "purchase" to BUY. Unmapped values pass through unchanged. */
    valueMaps: z.object({ category: valueMap(PRODUCT_CATEGORIES), type: valueMap(TRANSACTION_TYPES) }).strict(),
  })
  .strict();

export type BackOfficeMapping = z.infer<typeof mappingSchema>;
export type FileKind = "CLIENTS" | "HOLDINGS" | "TRANSACTIONS";
export type MappingIssue = { path: string; code: string };

const canonical = <T extends Record<string, unknown>>(keys: (keyof T & string)[]) => Object.fromEntries(keys.map((k) => [k, k])) as Record<keyof T & string, string>;

export const DEFAULT_MAPPING: BackOfficeMapping = {
  version: 1,
  dateFormat: "iso",
  updatePolicy: "fill_blank",
  filePrefixes: { clients: "clients", holdings: "holdings", transactions: "transactions" },
  clients: canonical<z.infer<typeof clientsSchema>>(["clientCode", "pan", "mobile", "email", "name", "city", "state", "clientType", "investmentCategory"]),
  holdings: canonical<z.infer<typeof holdingsSchema>>(["clientCode", "pan", "mobile", "email", "accountNumber", "productCode", "productName", "category", "isin", "quantity", "avgCost", "currentValue", "closed", "asOfDate", "revision", "externalRef"]),
  transactions: canonical<z.infer<typeof transactionsSchema>>(["clientCode", "pan", "mobile", "email", "externalRef", "accountNumber", "productCode", "type", "date", "settlementDate", "quantity", "price", "grossAmount", "netAmount", "brokerage", "revision"]),
  valueMaps: { category: {}, type: {} },
};

/** Validates a stored or submitted mapping. Issues carry a path and a code only. */
export function parseMapping(input: unknown): { ok: true; mapping: BackOfficeMapping } | { ok: false; issues: MappingIssue[] } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, issues: [{ path: "mapping", code: "not_an_object" }] };
  const parsed = mappingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.join(".") || "mapping", code: i.code })) };
  const m = parsed.data;
  for (const kind of ["clients", "holdings", "transactions"] as const) {
    const cols = Object.values(m[kind]).filter((v): v is string => typeof v === "string").map((v) => v.toLowerCase());
    if (new Set(cols).size !== cols.length) return { ok: false, issues: [{ path: kind, code: "duplicate_column" }] };
    if (!m[kind].clientCode && !m[kind].pan) return { ok: false, issues: [{ path: kind, code: "no_strong_identifier_column" }] };
  }
  return { ok: true, mapping: m };
}

/** Which kind of file a name is, by its configured prefix. Only plain `<prefix>.csv` names qualify (no path separators). */
export function kindForFileName(name: string, mapping: BackOfficeMapping): FileKind | null {
  if (!/^[A-Za-z0-9._-]+\.csv$/i.test(name)) return null;
  const n = name.toLowerCase();
  if (n.startsWith(mapping.filePrefixes.clients.toLowerCase())) return "CLIENTS";
  if (n.startsWith(mapping.filePrefixes.holdings.toLowerCase())) return "HOLDINGS";
  if (n.startsWith(mapping.filePrefixes.transactions.toLowerCase())) return "TRANSACTIONS";
  return null;
}

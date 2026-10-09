import { z } from "zod";

import { normalizeEmail, normalizePan, normalizePhone, PAN_REGEX } from "@/lib/utils/normalize-contact";

/** Contract version this build understands. Additive changes keep 1; a breaking change ships as 2 on the same route. */
export const CONTRACT_VERSION = 1;

export const LIMITS = {
  /** Raw request body, in bytes. */
  bodyBytes: 2_000_000,
  customers: 100,
  /** Holdings plus transactions for one customer. */
  rowsPerCustomer: 1000,
  /** Holdings plus transactions across the whole batch. */
  rowsPerBatch: 5000,
} as const;

export const PRODUCT_CATEGORIES = ["EQUITY", "MUTUAL_FUND", "PMS", "INSURANCE", "BOND", "FIXED_DEPOSIT", "NPS", "AIF", "OTHER"] as const;
export const TRANSACTION_TYPES = ["BUY", "SELL", "SIP", "REDEMPTION", "DIVIDEND", "SWITCH_IN", "SWITCH_OUT", "CHARGES", "OTHER"] as const;
export type ProductCategoryName = (typeof PRODUCT_CATEGORIES)[number];
export type TransactionTypeName = (typeof TRANSACTION_TYPES)[number];

/** Transactions dated further ahead than this (clock skew between systems) are refused. */
const FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

/** Issues carry a path and a short code only: never the submitted value. */
export type Issue = { path: string; code: string };

const SAFE_ID = /^[A-Za-z0-9._:@/-]+$/;
const envelopeSchema = z.object({
  version: z.literal(CONTRACT_VERSION),
  batchId: z.string().min(1).max(100).regex(SAFE_ID),
  customers: z.array(z.unknown()).min(1).max(LIMITS.customers),
});

export type Envelope = { version: 1; batchId: string; customers: unknown[] };

function rowCount(entry: unknown): number {
  if (typeof entry !== "object" || entry === null) return 0;
  const e = entry as Record<string, unknown>;
  return (Array.isArray(e.holdings) ? e.holdings.length : 0) + (Array.isArray(e.transactions) ? e.transactions.length : 0);
}

/** Validates only the batch envelope. Each customer entry is validated on its own (mapCustomerEntry) so one bad
 * customer never costs the rest of the batch. */
export function parseEnvelope(payload: unknown): { ok: true; envelope: Envelope } | { ok: false; issues: Issue[] } {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return { ok: false, issues: [{ path: "payload", code: "not_an_object" }] };
  const parsed = envelopeSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.join(".") || "payload", code: i.code })) };
  }
  const total = parsed.data.customers.reduce<number>((sum, c) => sum + rowCount(c), 0);
  if (total > LIMITS.rowsPerBatch) return { ok: false, issues: [{ path: "customers", code: "too_many_rows" }] };
  return { ok: true, envelope: { version: 1, batchId: parsed.data.batchId, customers: parsed.data.customers } };
}

// ---- customer entry -------------------------------------------------------------------------------------------

const numeric = z.union([z.number(), z.string().trim().regex(/^-?\d+(\.\d+)?$/)]).transform(Number).pipe(z.number().finite());
const nonNegative = numeric.pipe(z.number().min(0));
const code = z.string().trim().min(1).max(100).regex(SAFE_ID);
const dateLike = z.string().trim().min(8).max(40).refine((v) => !Number.isNaN(Date.parse(v)), "date");

const holdingSchema = z.object({
  accountNumber: code,
  productCode: code,
  productName: z.string().trim().min(1).max(200).optional(),
  category: z.enum(PRODUCT_CATEGORIES).optional(),
  isin: z.string().trim().regex(/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/).optional(),
  quantity: nonNegative,
  avgCost: nonNegative.optional(),
  currentValue: nonNegative.optional(),
  asOfDate: dateLike,
  externalRef: code.optional(),
});

const transactionSchema = z.object({
  externalRef: code,
  accountNumber: code,
  productCode: code.optional(),
  type: z.enum(TRANSACTION_TYPES),
  date: dateLike,
  settlementDate: dateLike.optional(),
  quantity: numeric.optional(),
  price: nonNegative.optional(),
  grossAmount: numeric,
  netAmount: numeric.optional(),
  brokerage: nonNegative.optional(),
});

export type MappedHolding = {
  index: number;
  accountNumber: string;
  productCode: string;
  productName: string;
  category: ProductCategoryName;
  isin: string | null;
  quantity: number;
  avgCost: number | null;
  currentValue: number | null;
  asOfDate: Date;
  externalRef: string;
};

export type MappedTransaction = {
  index: number;
  externalRef: string;
  accountNumber: string;
  productCode: string | null;
  transactionType: TransactionTypeName;
  transactionDate: Date;
  settlementDate: Date | null;
  quantity: number | null;
  price: number | null;
  grossAmount: number;
  netAmount: number | null;
  brokerageAmount: number | null;
};

export type CustomerIdentity = { clientCode?: string; pan?: string; phoneKey?: string; email?: string };
export type RowError = { kind: "holding" | "transaction"; index: number; code: "INVALID_ROW"; fields: string[] };

export type MappedCustomer =
  | { ok: true; identity: CustomerIdentity; holdings: MappedHolding[]; transactions: MappedTransaction[]; rowErrors: RowError[] }
  | { ok: false; code: "INVALID_ENTRY" | "NO_IDENTIFIER" | "TOO_MANY_ROWS" };

function toIdentity(raw: unknown): CustomerIdentity {
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const identity: CustomerIdentity = {};
  const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : undefined);
  const clientCode = text(o.clientCode, 40);
  if (clientCode && /^[A-Za-z0-9-]+$/.test(clientCode)) identity.clientCode = clientCode.toUpperCase();
  const pan = text(o.pan, 20);
  if (pan && PAN_REGEX.test(normalizePan(pan))) identity.pan = normalizePan(pan);
  const mobile = text(o.mobile, 25);
  if (mobile) {
    let digits = normalizePhone(mobile);
    if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
    if (digits.length >= 10 && digits.length <= 15) identity.phoneKey = digits.slice(-10);
  }
  const email = text(o.email, 200);
  if (email && z.email().safeParse(normalizeEmail(email)).success) identity.email = normalizeEmail(email);
  return identity;
}

const midnightUtc = (iso: string) => {
  // A bare date means that calendar day; a timestamp is truncated to its UTC calendar day (snapshots are per day).
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

/** Validates and normalises one customer entry. Bad rows are dropped and reported by position and field name only. */
export function mapCustomerEntry(entry: unknown, now: number = Date.now()): MappedCustomer {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return { ok: false, code: "INVALID_ENTRY" };
  const e = entry as Record<string, unknown>;
  const identity = toIdentity(e.customer);
  if (Object.keys(identity).length === 0) return { ok: false, code: "NO_IDENTIFIER" };
  const holdingsIn = Array.isArray(e.holdings) ? e.holdings : [];
  const txnsIn = Array.isArray(e.transactions) ? e.transactions : [];
  if (holdingsIn.length + txnsIn.length > LIMITS.rowsPerCustomer) return { ok: false, code: "TOO_MANY_ROWS" };

  const rowErrors: RowError[] = [];
  const fieldsOf = (error: z.ZodError) => [...new Set(error.issues.map((i) => String(i.path[0] ?? "row")))].slice(0, 6);

  const holdings: MappedHolding[] = [];
  holdingsIn.forEach((raw, index) => {
    const p = holdingSchema.safeParse(raw);
    if (!p.success) return void rowErrors.push({ kind: "holding", index, code: "INVALID_ROW", fields: fieldsOf(p.error) });
    const h = p.data;
    holdings.push({
      index,
      accountNumber: h.accountNumber,
      productCode: h.productCode,
      productName: h.productName ?? h.productCode,
      category: h.category ?? "OTHER",
      isin: h.isin ?? null,
      quantity: h.quantity,
      avgCost: h.avgCost ?? null,
      currentValue: h.currentValue ?? null,
      asOfDate: midnightUtc(h.asOfDate),
      externalRef: h.externalRef ?? `${h.accountNumber}-${h.productCode}`,
    });
  });

  const transactions: MappedTransaction[] = [];
  txnsIn.forEach((raw, index) => {
    const p = transactionSchema.safeParse(raw);
    if (!p.success) return void rowErrors.push({ kind: "transaction", index, code: "INVALID_ROW", fields: fieldsOf(p.error) });
    const t = p.data;
    const transactionDate = new Date(t.date);
    if (transactionDate.getTime() > now + FUTURE_SKEW_MS) return void rowErrors.push({ kind: "transaction", index, code: "INVALID_ROW", fields: ["date"] });
    transactions.push({
      index,
      externalRef: t.externalRef,
      accountNumber: t.accountNumber,
      productCode: t.productCode ?? null,
      transactionType: t.type,
      transactionDate,
      settlementDate: t.settlementDate ? new Date(t.settlementDate) : null,
      quantity: t.quantity ?? null,
      price: t.price ?? null,
      grossAmount: t.grossAmount,
      netAmount: t.netAmount ?? null,
      brokerageAmount: t.brokerage ?? null,
    });
  });

  return { ok: true, identity, holdings, transactions, rowErrors };
}

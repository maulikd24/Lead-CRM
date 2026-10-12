import { z } from "zod";

import { normalizeEmail, normalizePan, normalizePhone, PAN_REGEX } from "@/lib/utils/normalize-contact";

import { parseDecimal } from "./decimal";
import { parseIso, withinBounds } from "./dates";

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

const decimal = (signed: boolean) =>
  z.union([z.number(), z.string()]).transform((v, ctx) => {
    const r = parseDecimal(v, { signed });
    if (r === null) {
      ctx.addIssue({ code: "custom", message: "decimal" });
      return z.NEVER;
    }
    return r;
  });
const nonNegative = decimal(false);
const signed = decimal(true);
const code = z.string().trim().min(1).max(100).regex(SAFE_ID);
const isoText = z.string().trim().min(10).max(40);
const revision = z.number().int().min(0).max(2_000_000_000);

const holdingSchema = z.object({
  accountNumber: code,
  productCode: code,
  productName: z.string().trim().min(1).max(200).optional(),
  category: z.enum(PRODUCT_CATEGORIES).optional(),
  isin: z.string().trim().regex(/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/).optional(),
  quantity: nonNegative.optional(),
  avgCost: nonNegative.optional(),
  currentValue: nonNegative.optional(),
  /** A holding that has been sold: stored as quantity 0 and value 0 and hidden by the UI. */
  closed: z.boolean().optional(),
  asOfDate: isoText,
  revision,
  externalRef: code.optional(),
});

const transactionSchema = z.object({
  externalRef: code,
  accountNumber: code,
  productCode: code.optional(),
  type: z.enum(TRANSACTION_TYPES),
  date: isoText,
  settlementDate: isoText.optional(),
  /** Signed: a reversal or sell may be negative if that is how the back office models it. */
  quantity: signed.optional(),
  price: nonNegative.optional(),
  grossAmount: signed,
  netAmount: signed.optional(),
  brokerage: nonNegative.optional(),
  revision,
});

export type MappedHolding = {
  index: number;
  accountNumber: string;
  productCode: string;
  productName: string;
  category: ProductCategoryName;
  isin: string | null;
  /** Canonical decimal strings: never routed through floating point. */
  quantity: string;
  avgCost: string | null;
  currentValue: string | null;
  asOfDate: Date;
  revision: number;
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
  quantity: string | null;
  price: string | null;
  grossAmount: string;
  netAmount: string | null;
  brokerageAmount: string | null;
  revision: number;
};

export type CustomerIdentity = { clientCode?: string; pan?: string; phoneKey?: string; email?: string };
export type RowError = { kind: "holding" | "transaction"; index: number; code: "INVALID_ROW" | "DUPLICATE_KEY"; fields: string[] };

export type MappedCustomer =
  | { ok: true; identity: CustomerIdentity; holdings: MappedHolding[]; transactions: MappedTransaction[]; rowErrors: RowError[] }
  | { ok: false; code: "INVALID_ENTRY" | "NO_STRONG_ID" | "INVALID_IDENTIFIER" | "TOO_MANY_ROWS" };

type IdentityResult = { ok: true; identity: CustomerIdentity } | { ok: false; code: "NO_STRONG_ID" | "INVALID_IDENTIFIER" };

/** Only clientCode or PAN may authorise a write. Mobile and email are corroboration. An identifier that is present
 * but malformed is refused outright (a typo must never silently fall back to another identifier). */
function toIdentity(raw: unknown): IdentityResult {
  const o = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const present = (v: unknown) => v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "");
  const identity: CustomerIdentity = {};

  if (present(o.clientCode)) {
    if (typeof o.clientCode !== "string" || o.clientCode.length > 40 || !/^[A-Za-z0-9-]+$/.test(o.clientCode.trim())) return { ok: false, code: "INVALID_IDENTIFIER" };
    identity.clientCode = o.clientCode.trim().toUpperCase();
  }
  if (present(o.pan)) {
    if (typeof o.pan !== "string" || !PAN_REGEX.test(normalizePan(o.pan))) return { ok: false, code: "INVALID_IDENTIFIER" };
    identity.pan = normalizePan(o.pan);
  }
  if (present(o.mobile)) {
    if (typeof o.mobile !== "string" || o.mobile.length > 25) return { ok: false, code: "INVALID_IDENTIFIER" };
    let digits = normalizePhone(o.mobile);
    if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
    if (digits.length < 10 || digits.length > 15) return { ok: false, code: "INVALID_IDENTIFIER" };
    identity.phoneKey = digits.slice(-10);
  }
  if (present(o.email)) {
    if (typeof o.email !== "string" || o.email.length > 200 || !z.email().safeParse(normalizeEmail(o.email)).success) return { ok: false, code: "INVALID_IDENTIFIER" };
    identity.email = normalizeEmail(o.email);
  }
  if (!identity.clientCode && !identity.pan) return { ok: false, code: "NO_STRONG_ID" };
  return { ok: true, identity };
}

const midnightUtc = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Validates and normalises one customer entry. Bad rows are dropped and reported by position and field name only. */
export function mapCustomerEntry(entry: unknown, now: number = Date.now()): MappedCustomer {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return { ok: false, code: "INVALID_ENTRY" };
  const e = entry as Record<string, unknown>;
  const identity = toIdentity(e.customer);
  if (!identity.ok) return identity;
  const holdingsIn = Array.isArray(e.holdings) ? e.holdings : [];
  const txnsIn = Array.isArray(e.transactions) ? e.transactions : [];
  if (holdingsIn.length + txnsIn.length > LIMITS.rowsPerCustomer) return { ok: false, code: "TOO_MANY_ROWS" };

  const rowErrors: RowError[] = [];
  const invalid = (kind: RowError["kind"], index: number, fields: string[]) => void rowErrors.push({ kind, index, code: "INVALID_ROW", fields: fields.slice(0, 6) });
  const fieldsOf = (error: z.ZodError) => [...new Set(error.issues.map((i) => String(i.path[0] ?? "row")))];

  const holdings: MappedHolding[] = [];
  holdingsIn.forEach((raw, index) => {
    const p = holdingSchema.safeParse(raw);
    if (!p.success) return invalid("holding", index, fieldsOf(p.error));
    const h = p.data;
    const asOf = parseIso(h.asOfDate);
    if (!asOf || !withinBounds(asOf, now)) return invalid("holding", index, ["asOfDate"]);
    if (!h.closed && h.quantity === undefined) return invalid("holding", index, ["quantity"]);
    holdings.push({
      index,
      accountNumber: h.accountNumber,
      productCode: h.productCode,
      productName: h.productName ?? h.productCode,
      category: h.category ?? "OTHER",
      isin: h.isin ?? null,
      quantity: h.closed ? "0" : (h.quantity as string),
      avgCost: h.avgCost ?? null,
      currentValue: h.closed ? "0" : (h.currentValue ?? null),
      asOfDate: midnightUtc(asOf),
      revision: h.revision,
      externalRef: h.externalRef ?? `${h.accountNumber}-${h.productCode}`,
    });
  });

  const transactions: MappedTransaction[] = [];
  txnsIn.forEach((raw, index) => {
    const p = transactionSchema.safeParse(raw);
    if (!p.success) return invalid("transaction", index, fieldsOf(p.error));
    const t = p.data;
    const date = parseIso(t.date);
    if (!date || !withinBounds(date, now)) return invalid("transaction", index, ["date"]);
    const settlement = t.settlementDate === undefined ? null : parseIso(t.settlementDate);
    if (t.settlementDate !== undefined && (!settlement || settlement.getTime() < Date.UTC(2000, 0, 1))) return invalid("transaction", index, ["settlementDate"]);
    transactions.push({
      index,
      externalRef: t.externalRef,
      accountNumber: t.accountNumber,
      productCode: t.productCode ?? null,
      transactionType: t.type,
      transactionDate: date,
      settlementDate: settlement,
      quantity: t.quantity ?? null,
      price: t.price ?? null,
      grossAmount: t.grossAmount,
      netAmount: t.netAmount ?? null,
      brokerageAmount: t.brokerage ?? null,
      revision: t.revision,
    });
  });

  return { ok: true, identity: identity.identity, holdings, transactions, rowErrors };
}

/**
 * Maps every entry of a batch and then rejects duplicate natural keys: a key that appears more than once inside a
 * customer, or in more than one customer, is refused in ALL its occurrences (never "last one wins"), and an account
 * number claimed by more than one customer entry refuses the rows on it. A resend therefore always lands the same.
 */
export function mapBatch(entries: unknown[], now: number = Date.now()): MappedCustomer[] {
  const mapped = entries.map((e) => mapCustomerEntry(e, now));

  const holdingKey = (h: MappedHolding) => `${h.externalRef}|${h.asOfDate.toISOString()}`;
  const hCount = new Map<string, number>();
  const tCount = new Map<string, number>();
  const accountOwners = new Map<string, Set<number>>();
  mapped.forEach((m, i) => {
    if (!m.ok) return;
    for (const h of m.holdings) {
      hCount.set(holdingKey(h), (hCount.get(holdingKey(h)) ?? 0) + 1);
      (accountOwners.get(h.accountNumber) ?? accountOwners.set(h.accountNumber, new Set()).get(h.accountNumber)!).add(i);
    }
    for (const t of m.transactions) {
      tCount.set(t.externalRef, (tCount.get(t.externalRef) ?? 0) + 1);
      (accountOwners.get(t.accountNumber) ?? accountOwners.set(t.accountNumber, new Set()).get(t.accountNumber)!).add(i);
    }
  });

  return mapped.map((m) => {
    if (!m.ok) return m;
    const shared = (account: string) => (accountOwners.get(account)?.size ?? 0) > 1;
    const dupH = (h: MappedHolding) => (hCount.get(holdingKey(h)) ?? 0) > 1 || shared(h.accountNumber);
    const dupT = (t: MappedTransaction) => (tCount.get(t.externalRef) ?? 0) > 1 || shared(t.accountNumber);
    const errors: RowError[] = [...m.rowErrors];
    for (const h of m.holdings) if (dupH(h)) errors.push({ kind: "holding", index: h.index, code: "DUPLICATE_KEY", fields: [] });
    for (const t of m.transactions) if (dupT(t)) errors.push({ kind: "transaction", index: t.index, code: "DUPLICATE_KEY", fields: [] });
    return { ...m, holdings: m.holdings.filter((h) => !dupH(h)), transactions: m.transactions.filter((t) => !dupT(t)), rowErrors: errors };
  });
}

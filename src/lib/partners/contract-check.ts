import type { z } from "zod";

import { refereePageSchema, referrerDetailSchema, referrerPageSchema, summarySchema, withdrawalPageSchema, type Summary } from "./schemas";
import { kycBadge, referrerStatusBadge, funnelBadge, withdrawalBadge } from "./view-models";

/**
 * Pure checks behind scripts/partner-contract-check.ts. Findings carry field NAMES, paths and counts only:
 * they never contain a value from a response.
 */
export type Finding = { endpoint: string; level: "fail" | "warn" | "info"; code: string; detail: string };
const f = (endpoint: string, level: Finding["level"], code: string, detail: string): Finding => ({ endpoint, level, code, detail });

export type Endpoint = "summary" | "referrers" | "referrer" | "referees" | "withdrawals";

const SCHEMAS: Record<Endpoint, z.ZodType> = {
  summary: summarySchema,
  referrers: referrerPageSchema,
  referrer: referrerDetailSchema,
  referees: refereePageSchema,
  withdrawals: withdrawalPageSchema,
};

/* ---------- key-level inspection ---------- */

const SENSITIVE = /(^|_)(pan|bank|ifsc|accountno|accountnumber|account_number|upi)(_|$)|^(pan|bank|ifsc)[A-Z]|[a-z](Pan|Bank|Ifsc|AccountNumber)(?![a-z])/;

/** Paths of keys that look like PAN or bank details, anywhere in the response. Arrays are written as "[]". */
export function sensitiveKeyPaths(data: unknown, prefix = ""): string[] {
  const out: string[] = [];
  if (Array.isArray(data)) {
    const seen = new Set<string>();
    for (const el of data) for (const p of sensitiveKeyPaths(el, `${prefix}[]`)) if (!seen.has(p)) { seen.add(p); out.push(p); }
    return out;
  }
  if (data && typeof data === "object") {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      const path = prefix ? (prefix.endsWith("[]") ? `${prefix}.${k}` : `${prefix}.${k}`) : k;
      if (SENSITIVE.test(k)) out.push(path);
      else out.push(...sensitiveKeyPaths(v, path));
    }
  }
  return out;
}

type Def = { type: string; innerType?: z.ZodType; in?: z.ZodType; shape?: Record<string, z.ZodType>; element?: z.ZodType };
const defOf = (s: z.ZodType): Def => (s as unknown as { _zod: { def: Def } })._zod.def;

function unwrap(schema: z.ZodType): z.ZodType {
  let s = schema;
  for (let i = 0; i < 12; i++) {
    const d = defOf(s);
    if (d.type === "optional" || d.type === "nullable" || d.type === "default" || d.type === "readonly") s = d.innerType as z.ZodType;
    else if (d.type === "pipe") s = d.in as z.ZodType;
    else break;
  }
  return s;
}

/** Keys present in the response that the schema does not declare (they are ignored by the workspace). */
export function unknownKeyPaths(schema: z.ZodType, data: unknown, prefix = ""): string[] {
  const s = unwrap(schema);
  const d = defOf(s);
  if (d.type === "array" && Array.isArray(data)) {
    const seen = new Set<string>();
    for (const el of data.slice(0, 50)) for (const p of unknownKeyPaths(d.element as z.ZodType, el, `${prefix}[]`)) seen.add(p);
    return [...seen];
  }
  if (d.type === "object" && data && typeof data === "object" && !Array.isArray(data)) {
    const shape = d.shape ?? {};
    const out: string[] = [];
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (!(k in shape)) out.push(path);
      else out.push(...unknownKeyPaths(shape[k], v, path));
    }
    return out;
  }
  return [];
}

/* ---------- per-endpoint check ---------- */

const issuePath = (path: PropertyKey[]) => path.map((p) => (typeof p === "number" ? "[]" : String(p))).join(".").replace(/\.\[\]/g, "[]") || "(root)";

function statusFields(endpoint: Endpoint, data: unknown): { name: string; unknown: number; total: number }[] {
  const items = (data as { items?: unknown[] } | null)?.items;
  const rows: Record<string, unknown>[] = endpoint === "referrer" ? [data as Record<string, unknown>] : Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
  const defs: [string, string, (s: string) => { label: string }][] =
    endpoint === "referrers" || endpoint === "referrer"
      ? [["status", "status", referrerStatusBadge], ["kycStatus", "kycStatus", kycBadge]]
      : endpoint === "referees"
        ? [["funnelStatus", "funnelStatus", funnelBadge], ["kycStatus", "kycStatus", kycBadge]]
        : endpoint === "withdrawals"
          ? [["status", "status", withdrawalBadge]]
          : [];
  return defs.map(([name, key, badge]) => {
    const present = rows.filter((r) => r && typeof r[key] === "string");
    return { name, total: present.length, unknown: present.filter((r) => badge(r[key] as string).label === "Unknown").length };
  });
}

export function checkResponse(endpoint: Endpoint, data: unknown): Finding[] {
  const out: Finding[] = [];
  const parsed = SCHEMAS[endpoint].safeParse(data);
  if (!parsed.success) {
    const paths = [...new Set(parsed.error.issues.map((i) => issuePath(i.path)))];
    for (const p of paths) out.push(f(endpoint, "fail", "required_field", `required field missing or of the wrong type: ${p}`));
  } else {
    if ((endpoint === "referrers" || endpoint === "referees" || endpoint === "withdrawals") && (parsed.data as { total: number | null }).total === null) {
      out.push(f(endpoint, "warn", "total_missing", "list has no total: pagination shows an unknown total"));
    }
  }
  for (const p of unknownKeyPaths(SCHEMAS[endpoint], data)) out.push(f(endpoint, "info", "extra_key", `unknown key ignored: ${p}`));
  for (const p of sensitiveKeyPaths(data)) out.push(f(endpoint, "fail", "sensitive_key", `PAN-like or bank-like key present: ${p} (the service must not return it)`));
  if (parsed.success) {
    for (const s of statusFields(endpoint, data)) {
      if (s.unknown > 0) out.push(f(endpoint, "warn", "unknown_enum", `${s.unknown} of ${s.total} ${s.name} values are not recognised (shown as Unknown)`));
    }
  }
  return out;
}

/* ---------- cross-checks, pagination, auth ---------- */

export type CrossInput = {
  summary?: Summary;
  referrersTotal?: number | null;
  earningsSum?: number;
  withdrawalsSummary?: Record<string, { count: number; amount: number }>;
  withdrawalStatusTotals?: Record<string, number | null>;
};

export function crossChecks(i: CrossInput): Finding[] {
  const out: Finding[] = [];
  const s = i.summary;
  if (s && i.referrersTotal != null && s.referrers.total !== i.referrersTotal) out.push(f("cross", "fail", "count_mismatch", "summary referrers.total differs from the referrers list total"));
  if (s && i.earningsSum !== undefined && s.earnings.total !== null && Math.abs(s.earnings.total - i.earningsSum) > 0.01) {
    out.push(f("cross", "fail", "sum_mismatch", "summary earnings.total differs from the sum of the referrers' earningsTotal"));
  }
  if (s && s.monthly.length > 0 && Math.abs(s.monthly[s.monthly.length - 1].earnings - s.earnings.lastMonth) > 0.01) {
    out.push(f("cross", "warn", "month_mismatch", "the latest monthly entry differs from earnings.lastMonth"));
  }
  for (const [status, row] of Object.entries(i.withdrawalsSummary ?? {})) {
    const t = i.withdrawalStatusTotals?.[status];
    if (t != null && t !== row.count) out.push(f("cross", "fail", "status_mismatch", `withdrawal summary count for status ${status} differs from the filtered list total`));
  }
  return out;
}

export function checkPaginationEcho(asked: { limit: number; offset: number }, got: { limit: number; offset: number }): Finding[] {
  const out: Finding[] = [];
  if (asked.limit !== got.limit) out.push(f("pagination", "warn", "limit_echo", "the service did not echo the requested limit"));
  if (asked.offset !== got.offset) out.push(f("pagination", "warn", "offset_echo", "the service did not echo the requested offset"));
  return out;
}

export function checkAuthStatus(statusWithoutToken: number): Finding[] {
  return statusWithoutToken === 401 || statusWithoutToken === 403 ? [] : [f("auth", "fail", "no_token_accepted", `a request without a token was not refused (HTTP ${statusWithoutToken})`)];
}

export function summarise(findings: Finding[]) {
  const n = (l: Finding["level"]) => findings.filter((x) => x.level === l).length;
  return { passed: n("fail") === 0, fail: n("fail"), warn: n("warn"), info: n("info") };
}

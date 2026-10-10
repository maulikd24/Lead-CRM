// Decimal strings stay strings from the wire to Prisma's Decimal: no float rounding anywhere on the money path.

const DEC = /^-?\d{1,13}(\.\d{1,6})?$/;

/** Canonical form: no leading zeros, no trailing fraction zeros, no "-0". Input must already be a plain decimal. */
export function canonDecimal(s: string): string {
  const negative = s.startsWith("-");
  const [intRaw, fracRaw = ""] = (negative ? s.slice(1) : s).split(".");
  const int = intRaw.replace(/^0+(?=\d)/, "");
  const frac = fracRaw.replace(/0+$/, "");
  const body = frac ? `${int}.${frac}` : int;
  return negative && body !== "0" ? `-${body}` : body;
}

/** A number or numeric string with at most 13 integer digits and 6 decimals, else null. Numbers never use exponents. */
export function parseDecimal(v: unknown, opts: { signed: boolean }): string | null {
  let text: string;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    text = String(v);
  } else if (typeof v === "string") {
    text = v.trim();
  } else {
    return null;
  }
  if (!DEC.test(text)) return null;
  const canon = canonDecimal(text);
  if (!opts.signed && canon.startsWith("-")) return null;
  return canon;
}

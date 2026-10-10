/**
 * Exact money arithmetic for statements. Amounts are held as integers in units of 1e-8 rupee (BigInt) so sums never
 * pick up floating point error, and are rounded to paise exactly once, on the exact value, half away from zero.
 */
const SCALE_DIGITS = 8;
const UNITS_PER_PAISE = BigInt(10) ** BigInt(SCALE_DIGITS - 2);

const DECIMAL = /^([+-])?(\d+)(?:\.(\d+))?$/;

/** Reads a decimal string or a finite number as exact units. Anything else throws: a bad amount is never read as zero. */
export function parseUnits(value: string | number): bigint {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Amount is not a finite number");
    // Large whole numbers print with an exponent; BigInt reads them exactly.
    text = Number.isInteger(value) ? BigInt(value).toString() : value.toFixed(SCALE_DIGITS + 2);
  } else {
    text = value.trim();
  }
  const m = DECIMAL.exec(text);
  if (!m) throw new Error("Amount is not a decimal number");
  const [, sign, whole, frac = ""] = m;
  const padded = (frac + "0".repeat(SCALE_DIGITS + 1)).slice(0, SCALE_DIGITS + 1);
  let units = BigInt(whole) * BigInt(10) ** BigInt(SCALE_DIGITS) + BigInt(padded.slice(0, SCALE_DIGITS));
  if (Number(padded[SCALE_DIGITS]) >= 5) units += BigInt(1); // half up on the first dropped digit
  return sign === "-" ? -units : units;
}

export function sumUnits(values: bigint[]): bigint {
  return values.reduce((a, b) => a + b, BigInt(0));
}

/** Round to whole paise, ties away from zero. */
export function roundToPaise(units: bigint): bigint {
  const neg = units < BigInt(0);
  const abs = neg ? -units : units;
  const paise = (abs + UNITS_PER_PAISE / BigInt(2)) / UNITS_PER_PAISE;
  return neg ? -paise : paise;
}

/** "123.45" for BigInt(12345). For files and tests; screens use formatInr. */
export function formatPaise(paise: bigint): string {
  const neg = paise < BigInt(0);
  const abs = neg ? -paise : paise;
  const whole = abs / BigInt(100);
  const frac = (abs % BigInt(100)).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/** For display only (formatInr takes a number). Safe far beyond any real payout. */
export function paiseToNumber(paise: bigint): number {
  return Number(paise) / 100;
}

/** A percentage with at most four decimals ("10", "3.75", "0.0001"), held as an integer in units of 0.0001 percent. Anything else throws: a rate is never rounded. */
const RATE_DECIMALS = 4;
const RATE_SCALE = BigInt(10) ** BigInt(RATE_DECIMALS);
const RATE_TEXT = /^(\d{1,3})(?:\.(\d{1,4}))?$/;
export function parseRate(text: string): bigint {
  const m = RATE_TEXT.exec(text.trim());
  if (!m) throw new Error("A rate must be a percentage with at most four decimals");
  const rate = BigInt(m[1]) * RATE_SCALE + BigInt(((m[2] ?? "") + "0000").slice(0, RATE_DECIMALS));
  if (rate > BigInt(100) * RATE_SCALE) throw new Error("A rate cannot be above 100 percent");
  return rate;
}

/** `units` times a rate from parseRate, rounded ONCE to whole paise, half away from zero. Exact integer arithmetic. */
export function ratePaise(units: bigint, rate: bigint): bigint {
  const den = UNITS_PER_PAISE * BigInt(100) * RATE_SCALE;
  const num = units * rate;
  const neg = num < BigInt(0);
  const q = ((neg ? -num : num) + den / BigInt(2)) / den;
  return neg ? -q : q;
}

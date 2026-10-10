/**
 * Exact money arithmetic for statements. Amounts are held as integers in units of 1e-8 rupee (BigInt) so sums never
 * pick up floating point error, and are rounded to paise exactly once, on the exact value, half away from zero.
 */
const SCALE_DIGITS = 8;
const UNITS_PER_PAISE = 10n ** BigInt(SCALE_DIGITS - 2);

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
  let units = BigInt(whole) * 10n ** BigInt(SCALE_DIGITS) + BigInt(padded.slice(0, SCALE_DIGITS));
  if (Number(padded[SCALE_DIGITS]) >= 5) units += 1n; // half up on the first dropped digit
  return sign === "-" ? -units : units;
}

export function sumUnits(values: bigint[]): bigint {
  return values.reduce((a, b) => a + b, 0n);
}

/** Round to whole paise, ties away from zero. */
export function roundToPaise(units: bigint): bigint {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const paise = (abs + UNITS_PER_PAISE / 2n) / UNITS_PER_PAISE;
  return neg ? -paise : paise;
}

/** "123.45" for 12345n. For files and tests; screens use formatInr. */
export function formatPaise(paise: bigint): string {
  const neg = paise < 0n;
  const abs = neg ? -paise : paise;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/** For display only (formatInr takes a number). Safe far beyond any real payout. */
export function paiseToNumber(paise: bigint): number {
  return Number(paise) / 100;
}

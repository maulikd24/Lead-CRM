/** Money helpers for ad spend: stored as integer minor units (paise, cents) with an ISO 4217 currency code. */

export function currencyExponent(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** "123.45" (a major-unit decimal string, as ad platforms report spend) to minor units, exactly (no floats). Rounds half up. */
export function parseMinorUnits(value: string, currency: string): bigint {
  const text = value.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error("Not a non-negative decimal amount");
  const exponent = currencyExponent(currency);
  const [whole, fraction = ""] = text.split(".");
  const padded = fraction.padEnd(exponent, "0");
  let minor = BigInt(whole + padded.slice(0, exponent));
  if (padded.length > exponent && padded.charCodeAt(exponent) >= 53) minor += BigInt(1); // next digit >= "5"
  return minor;
}

export function minorToMajor(minor: bigint | number, currency: string): number {
  return Number(minor) / 10 ** currencyExponent(currency);
}

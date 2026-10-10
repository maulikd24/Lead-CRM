/** Rupee amounts in lakh/crore words for headline figures, full Indian grouping for exact ones. */
export function formatInr(value: number): string {
  const v = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (v >= 10_000_000) return `${sign}₹${(v / 10_000_000).toFixed(2)} Cr`;
  if (v >= 100_000) return `${sign}₹${(v / 100_000).toFixed(2)} L`;
  return `${sign}₹${Math.round(v).toLocaleString("en-IN")}`;
}

export const formatPct = (value: number, decimals = 1) => `${value.toFixed(decimals)}%`;

export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

const LOCALE = "en-IN";

/** Locale-pinned formatters — avoids SSR/client hydration mismatches from runtime-locale-dependent Intl defaults. */
export function formatDateTime(date: Date): string {
  return date.toLocaleString(LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString(LOCALE, { dateStyle: "medium" });
}

export function formatNumber(value: number): string {
  return value.toLocaleString(LOCALE);
}

export function formatStageAge(ageHours: number): string {
  return ageHours < 24 ? `${Math.round(ageHours)}h` : `${Math.round(ageHours / 24)}d`;
}

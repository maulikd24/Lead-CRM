import type { Confidence, TouchKind } from "./model";

const WHEN = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });

export function formatWhen(date: Date | null): string {
  if (!date) return "Not yet";
  const parts = Object.fromEntries(WHEN.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toLowerCase()}`;
}

export function formatInr(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Math.round(value));
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };

export const CONFIDENCE_TEXT: Record<Confidence, string> = {
  high: "High: the campaign id, or a partner or referral code, matches our own records.",
  medium: "Medium: matched by name or form, or the campaign has no spend data yet.",
  low: "Low: only the channel is known, not the campaign. It is never counted under a campaign.",
};

const KIND: Record<TouchKind, string> = { meta_ad: "Meta ad", google_ad: "Google ad", partner_code: "Partner code", referral_code: "Customer referral", form: "Website form", organic: "Organic sign-up" };
export const kindLabel = (kind: TouchKind): string => KIND[kind];

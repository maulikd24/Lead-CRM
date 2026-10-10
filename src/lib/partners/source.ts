/** Where the Partner workspace reads its data from. */
export type PartnerSource = "native" | "external" | "sample";

/**
 * Picks the data source from PARTNER_SOURCE. The default is "native": this CRM's own earnings tables, no external
 * key and no network. "external" keeps the referral API adapter, "sample" serves made-up data for development.
 * An unknown value falls back to native, the one source that makes no network call. Pure.
 */
export function resolvePartnerSource(env: Record<string, string | undefined> = process.env): PartnerSource {
  const v = (env.PARTNER_SOURCE ?? "").trim().toLowerCase();
  if (v === "external") return "external";
  if (v === "sample") return "sample";
  return "native";
}

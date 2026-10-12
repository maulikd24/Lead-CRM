/** Where the Partner workspace reads its data from. */
export type PartnerSource = "native" | "sample";

type Env = Record<string, string | undefined>;

/**
 * Picks the data source from PARTNER_SOURCE. The default is "native": this CRM's own earnings tables, no external key and
 * no network. "sample" serves made-up data for development. Anything else, including the retired "external" value, reads
 * the native source: the one that makes no network call. Pure.
 */
export function resolvePartnerSource(env: Env = process.env): PartnerSource {
  return (env.PARTNER_SOURCE ?? "").trim().toLowerCase() === "sample" ? "sample" : "native";
}

/** Made-up data is only ever served outside production, or where PARTNER_ALLOW_SAMPLE=1 says so (a demo). Pure. */
export function sampleAllowed(env: Env = process.env): boolean {
  return env.NODE_ENV !== "production" || env.PARTNER_ALLOW_SAMPLE === "1";
}

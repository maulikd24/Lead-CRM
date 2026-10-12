const REGION_RE = /^[a-z0-9]{2,6}$/;

export function normalizeRegion(raw: string | undefined | null): string {
  return (raw ?? "").trim().toLowerCase();
}

/** CleverTap's default (blank) region is Europe; every other region has its own host prefix. */
export function clevertapHost(region: string): string {
  const r = normalizeRegion(region);
  if (r === "") return "api.clevertap.com";
  if (!REGION_RE.test(r)) throw new Error(`Invalid CleverTap region "${region}"`);
  return `${r}.api.clevertap.com`;
}

export function isIndiaRegion(region: string | undefined | null): boolean {
  return normalizeRegion(region) === "in1";
}

/** Allvest policy: customer data is only ever written to CleverTap in the India region. */
export function assertWriteAllowed(region: string | undefined | null): void {
  if (!isIndiaRegion(region)) {
    throw new Error("Blocked: CleverTap writes are allowed only in the India region (in1). Ask CleverTap to enable the India data centre for the account, then set region to in1.");
  }
}

/** The single master switch for every CleverTap write (batch push and journey action). Only the exact value "1" enables it. */
export function writesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CLEVERTAP_PUSH_ENABLED === "1";
}

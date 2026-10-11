import type { AumBand } from "./events";
import { createGoogleOfflineDestination } from "./adapters/google-offline";
import { createMetaCapiDestination, type FetchLike } from "./adapters/meta-capi";
import { FakeDestination } from "./fake-destination";
import { DEFAULT_DESTINATION_SETTINGS, type DestinationSettings } from "./gate";
import type { ConversionDestination, DestinationKey } from "./types";

type Env = Record<string, string | undefined>;

/** Ships dark: nothing is queued, sent, shown or reachable unless this is exactly "1". */
export const closedLoopEnabled = (env: Env = process.env): boolean => env.CLOSED_LOOP_CONVERSIONS_ENABLED === "1";

/** Test and demo destination (no network) can be used only when this is "1". */
export const demoDestinationAllowed = (env: Env = process.env): boolean => env.CLOSED_LOOP_DEMO === "1";

export type GlobalSettings = { killSwitch: boolean; aumBands: AumBand[] | null };

/** The kill switch is the environment OR the Admin toggle: either stops every send. */
export const killSwitchOn = (env: Env, global: GlobalSettings): boolean => env.CLOSED_LOOP_KILL_SWITCH === "1" || global.killSwitch;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function parseDestinationSettings(raw: unknown): DestinationSettings {
  const o = obj(raw);
  const region = str(o.region).toLowerCase();
  return {
    ...DEFAULT_DESTINATION_SETTINGS,
    enabled: o.enabled === true,
    region: region || null,
    allowedRegions: Array.isArray(o.allowedRegions) ? o.allowedRegions.map(str).filter(Boolean).map((r) => r.toLowerCase()) : [],
    sendValue: o.sendValue === true,
  };
}

export function parseGlobalSettings(raw: unknown): GlobalSettings {
  const o = obj(raw);
  const bands = Array.isArray(o.aumBands)
    ? o.aumBands.flatMap((b) => {
        const x = obj(b);
        return str(x.label) && typeof x.min === "number" && x.min > 0 ? [{ label: str(x.label).slice(0, 20), min: x.min }] : [];
      })
    : [];
  return { killSwitch: o.killSwitch === true, aumBands: bands.length ? bands : null };
}

/** The credential form an Admin fills in. Entered in the app and stored encrypted; never asked for in chat or read from the environment. */
export const REAL_FIELDS: Record<"meta_capi" | "google_ads", { key: string; label: string; secret: boolean; hint?: string }[]> = {
  meta_capi: [
    { key: "pixelId", label: "Dataset (pixel) ID", secret: false },
    { key: "accessToken", label: "Access token", secret: true },
    { key: "testEventCode", label: "Test event code (optional)", secret: false, hint: "While set, events appear only in Meta's Test Events tab." },
  ],
  google_ads: [
    { key: "customerId", label: "Customer ID", secret: false },
    { key: "loginCustomerId", label: "Manager account ID (optional)", secret: false },
    { key: "developerToken", label: "Developer token", secret: true },
    { key: "clientId", label: "OAuth client ID", secret: false },
    { key: "clientSecret", label: "OAuth client secret", secret: true },
    { key: "refreshToken", label: "Refresh token", secret: true },
    { key: "conversionActionKyc", label: "Conversion action ID: KYC complete", secret: false },
    { key: "conversionActionFunding", label: "Conversion action ID: first funding", secret: false },
    { key: "conversionActionAum", label: "Conversion action ID: assets band (optional)", secret: false },
  ],
};

/** Builds a destination from stored credentials, or null when they are incomplete (the destination then counts as not set up). */
export function buildDestination(key: DestinationKey, credentials: Record<string, unknown>, fetch: FetchLike, opts: { demo?: boolean } = {}): ConversionDestination | null {
  const c = (k: string) => str(credentials[k]);
  if (key === "fake") return opts.demo ? new FakeDestination("fake") : null;
  if (key === "meta_capi") {
    if (!c("pixelId") || !c("accessToken")) return null;
    return createMetaCapiDestination({ config: { pixelId: c("pixelId"), accessToken: c("accessToken"), testEventCode: c("testEventCode") || undefined }, fetch });
  }
  if (!c("customerId") || !c("developerToken") || !c("clientId") || !c("clientSecret") || !c("refreshToken")) return null;
  const actions = { KYC_COMPLETE: c("conversionActionKyc"), FIRST_FUNDING: c("conversionActionFunding"), AUM_BAND: c("conversionActionAum") };
  if (!actions.KYC_COMPLETE && !actions.FIRST_FUNDING && !actions.AUM_BAND) return null;
  return createGoogleOfflineDestination({
    config: {
      customerId: c("customerId"), loginCustomerId: c("loginCustomerId") || undefined, developerToken: c("developerToken"), clientId: c("clientId"), clientSecret: c("clientSecret"), refreshToken: c("refreshToken"),
      conversionActions: Object.fromEntries(Object.entries(actions).filter(([, v]) => v)),
    },
    fetch,
  });
}

const UNIT = { lakh: 100_000, lakhs: 100_000, l: 100_000, lac: 100_000, crore: 10_000_000, crores: 10_000_000, cr: 10_000_000 } as const;

/** Assets bands typed by an Admin: "10L=1000000, 50L=5000000" (one per line or comma-separated). Rupees, or "10 lakh" / "1 crore". At most 10, distinct sizes. */
export function parseBandsText(text: string): { ok: true; bands: AumBand[] | null } | { ok: false; error: string } {
  const parts = text.split(/[\n,;]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { ok: true, bands: null };
  if (parts.length > 10) return { ok: false, error: "Use at most 10 bands." };
  const bands: AumBand[] = [];
  for (const part of parts) {
    const m = /^([^=]{1,20})=\s*([\d.]+)\s*([a-z]*)$/i.exec(part);
    const unit = m ? (m[3] ? UNIT[m[3].toLowerCase() as keyof typeof UNIT] : 1) : undefined;
    const min = m && unit ? Math.round(Number(m[2]) * unit) : NaN;
    if (!m || !unit || !Number.isFinite(min) || min <= 0) return { ok: false, error: `Could not read “${part}”. Use label=rupees, for example 10L=1000000.` };
    bands.push({ label: m[1].trim(), min });
  }
  if (new Set(bands.map((b) => b.min)).size !== bands.length) return { ok: false, error: "Two bands have the same size." };
  return { ok: true, bands: bands.sort((a, b) => a.min - b.min) };
}

export const bandsToText = (bands: AumBand[] | null): string => (bands ?? []).map((b) => `${b.label}=${b.min}`).join(", ");

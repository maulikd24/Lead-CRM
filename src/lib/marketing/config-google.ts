import { prisma } from "@/lib/db/prisma";
import { decryptJson } from "@/lib/security/crypto";

export { googleAdsReportingEnabled } from "./flags";

/** The Settings (IntegrationConfig) provider key for Google Ads reporting. */
export const GOOGLE_ADS_SETTINGS_PROVIDER = "google_ads";

export type GoogleAdsConfig = {
  /** Switched to Live, enabled, and holding every credential. Nothing touches the network unless this is true. */
  live: boolean;
  customerId?: string;
  loginCustomerId?: string;
  developerToken?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  apiVersion?: string;
};

function clean(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

/** Credentials are entered by an Admin in Settings and encrypted at rest like every other integration; nothing is read from env vars. Never log the result. */
export async function getGoogleAdsConfig(): Promise<GoogleAdsConfig> {
  const row = await prisma.integrationConfig.findUnique({ where: { provider: GOOGLE_ADS_SETTINGS_PROVIDER } });
  const credentials = row?.credentials ? decryptJson<Record<string, unknown>>(row.credentials as string) : {};
  const config = {
    customerId: clean(credentials.customerId),
    loginCustomerId: clean(credentials.loginCustomerId),
    developerToken: clean(credentials.developerToken),
    clientId: clean(credentials.clientId),
    clientSecret: clean(credentials.clientSecret),
    refreshToken: clean(credentials.refreshToken),
    apiVersion: clean(credentials.apiVersion),
  };
  const complete = Boolean(config.customerId && config.developerToken && config.clientId && config.clientSecret && config.refreshToken);
  return { live: row?.mode === "live" && row.isEnabled && complete, ...config };
}

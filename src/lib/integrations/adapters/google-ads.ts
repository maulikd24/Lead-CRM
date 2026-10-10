import type { IntegrationAdapter } from "@/lib/integrations/types";
import { AdsApiError } from "@/lib/marketing/ads-error";
import { createGoogleAdsClient } from "@/lib/marketing/providers/google-ads";

interface GoogleAdsCredentials {
  customerId: string;
  loginCustomerId?: string;
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  apiVersion?: string;
}

let creds: GoogleAdsCredentials | null = null;

const text = (value: unknown) => String(value ?? "");

/** Read-only ad reporting. There is no webhook and no action: this adapter exists for the Settings card and its connection test. */
export const googleAdsAdapter: IntegrationAdapter = {
  provider: "google_ads",

  async configure(credentials) {
    creds = {
      customerId: text(credentials.customerId),
      loginCustomerId: credentials.loginCustomerId ? text(credentials.loginCustomerId) : undefined,
      developerToken: text(credentials.developerToken),
      clientId: text(credentials.clientId),
      clientSecret: text(credentials.clientSecret),
      refreshToken: text(credentials.refreshToken),
      apiVersion: credentials.apiVersion ? text(credentials.apiVersion) : undefined,
    };
  },

  // One minimal read-only query: the account's name, currency and timezone.
  async testConnection() {
    try {
      if (!creds) return { ok: false, message: "Google Ads adapter not configured" };
      const client = createGoogleAdsClient({ ...creds, fetch });
      const account = await client.getAccount();
      return { ok: true, message: `Connected to "${account.name}" (${account.currency}, ${account.timezoneName}) using Google Ads API ${client.version}.` };
    } catch (error) {
      return { ok: false, message: error instanceof AdsApiError ? error.message : "Connection failed" };
    }
  },

  // No inbound webhook exists for this provider; fail closed.
  verifySignature() {
    return false;
  },

  async handleWebhook() {
    return [];
  },

  actions: {},
};

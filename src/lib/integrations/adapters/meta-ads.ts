import type { IntegrationAdapter } from "@/lib/integrations/types";
import { MetaAdsError, createMetaAdsClient } from "@/lib/marketing/meta-ads";

interface MetaAdsCredentials {
  accountId: string;
  accessToken: string;
  apiVersion?: string;
}

let creds: MetaAdsCredentials | null = null;

/** Read-only ad reporting. There is no webhook and no action: this adapter exists for the Settings card and its connection test. */
export const metaAdsAdapter: IntegrationAdapter = {
  provider: "meta_ads",

  async configure(credentials) {
    creds = {
      accountId: String(credentials.accountId ?? ""),
      accessToken: String(credentials.accessToken ?? ""),
      apiVersion: credentials.apiVersion ? String(credentials.apiVersion) : undefined,
    };
  },

  // One minimal read-only call: the account's name, currency and timezone.
  async testConnection() {
    try {
      if (!creds) throw new MetaAdsError("config", "Meta Ads adapter not configured");
      const client = createMetaAdsClient({ accountId: creds.accountId, accessToken: creds.accessToken, apiVersion: creds.apiVersion, fetch });
      const account = await client.getAccount();
      return { ok: true, message: `Connected to "${account.name}" (${account.currency}, ${account.timezoneName}) using Graph API ${client.version}.` };
    } catch (error) {
      return { ok: false, message: error instanceof MetaAdsError ? error.message : "Connection failed" };
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

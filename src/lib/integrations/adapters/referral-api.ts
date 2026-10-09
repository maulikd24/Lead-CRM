import type { IntegrationAdapter } from "@/lib/integrations/types";
import { createReferralApiClient, ReferralApiError } from "@/lib/partners/referral-api";
import { resolveConnection } from "@/lib/partners/connection";

/**
 * Referral API connection for the Partner workspace. Read-only: testConnection performs a single GET,
 * there are no webhooks (verifySignature fails closed) and no per-client actions.
 */
let creds: Record<string, unknown> = {};

export const referralApiAdapter: IntegrationAdapter = {
  provider: "referral_api",

  async configure(credentials) {
    creds = credentials;
  },

  async testConnection() {
    const conn = resolveConnection({ mode: "live", isEnabled: true, credentials: creds });
    if (conn.state !== "live") return { ok: false, message: "Enter an https base URL and a token first." };
    try {
      return await createReferralApiClient({ baseUrl: conn.baseUrl, token: conn.token }).ping();
    } catch (e) {
      return { ok: false, message: e instanceof ReferralApiError ? e.message : "Connection test failed." };
    }
  },

  verifySignature() {
    return false;
  },

  async handleWebhook() {
    return [];
  },

  actions: {},
};

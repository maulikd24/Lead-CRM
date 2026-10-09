import type { IntegrationAdapter } from "@/lib/integrations/types";

export const referralApiMockAdapter: IntegrationAdapter = {
  provider: "referral_api",

  async configure() {},

  async testConnection() {
    return { ok: true, message: "Mock mode: the workspace shows sample data and makes no network calls." };
  },

  // No webhooks exist for this provider in either mode.
  verifySignature() {
    return false;
  },

  async handleWebhook() {
    return [];
  },

  actions: {},
};

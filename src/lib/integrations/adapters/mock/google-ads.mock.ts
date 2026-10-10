import type { IntegrationAdapter } from "@/lib/integrations/types";

export const googleAdsMockAdapter: IntegrationAdapter = {
  provider: "google_ads",

  async configure() {},

  async testConnection() {
    return { ok: true, message: "Mock Google Ads connection OK (no network call, no real account required)" };
  },

  verifySignature() {
    return true;
  },

  async handleWebhook() {
    return [];
  },

  actions: {},
};

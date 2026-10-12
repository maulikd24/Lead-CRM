import type { IntegrationAdapter } from "@/lib/integrations/types";

export const metaAdsMockAdapter: IntegrationAdapter = {
  provider: "meta_ads",

  async configure() {},

  async testConnection() {
    return { ok: true, message: "Mock Meta Ads connection OK (no network call, no real account required)" };
  },

  verifySignature() {
    return true;
  },

  async handleWebhook() {
    return [];
  },

  actions: {},
};

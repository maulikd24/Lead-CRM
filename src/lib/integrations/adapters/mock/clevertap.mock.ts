import type { IntegrationAdapter } from "@/lib/integrations/types";

export const clevertapMockAdapter: IntegrationAdapter = {
  provider: "clevertap",

  async configure() {},

  async testConnection() {
    return { ok: true, message: "Mock Clevertap connection OK (no real account required)" };
  },

  // Mock adapters authenticate nothing; the webhook route refuses them in Production (isProductionRuntime).
  verifySignature() {
    return true;
  },

  async handleWebhook(payload) {
    const body = payload as { identity?: string; eventName?: string; eventProps?: Record<string, unknown> };
    return [
      {
        type: "campaign_event",
        clientEmail: body.identity,
        payload: { eventName: body.eventName ?? "campaign_clicked", props: body.eventProps ?? {} },
      },
    ];
  },

  actions: {
    async syncProfile() {
      return { success: true, data: { skipped: true, reason: "Profile data is owned by the app; nothing was uploaded.", mock: true } };
    },
  },
};

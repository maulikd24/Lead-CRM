import type { IntegrationAdapter } from "@/lib/integrations/types";

export const exotelMockAdapter: IntegrationAdapter = {
  provider: "exotel",

  async configure() {},

  async testConnection() {
    return { ok: true, message: "Mock Exotel connection OK (no real account required)" };
  },

  async handleWebhook(payload) {
    const body = payload as { CallSid?: string; Status?: string; From?: string; DialCallDuration?: string };
    return [
      {
        type: "call_completed",
        leadPhone: body.From,
        payload: {
          callSid: body.CallSid ?? `mock-call-${Date.now()}`,
          status: body.Status ?? "completed",
          durationSeconds: Number(body.DialCallDuration ?? 42),
        },
      },
    ];
  },

  actions: {
    async initiateCall(lead) {
      return {
        success: true,
        data: { callSid: `mock-call-${Date.now()}`, to: lead.phone, status: "queued", mock: true },
      };
    },
  },
};

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
        clientPhone: body.From,
        payload: {
          callSid: body.CallSid ?? `mock-call-${Date.now()}`,
          status: body.Status ?? "completed",
          durationSeconds: Number(body.DialCallDuration ?? 42),
        },
      },
    ];
  },

  actions: {
    async initiateCall(client) {
      return {
        success: true,
        data: { callSid: `mock-call-${Date.now()}`, to: client.mobile, status: "queued", mock: true },
      };
    },

    // Mocks Exotel's real behavior of calling back asynchronously — posts a canned transcript to
    // our own callback route immediately, so local/dev testing never needs real Exotel credentials.
    async triggerVoiceAnalysis(_client, params) {
      const activityId = String(params.activityId ?? "");
      if (!activityId) return { success: false, error: "triggerVoiceAnalysis requires activityId" };
      try {
        const base = process.env.NEXTAUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
        await fetch(`${base}/api/internal/exotel/voice-analyze-callback?secret=&activityId=${encodeURIComponent(activityId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: "[Mock transcript] RM: Hello, this is a mock call for local testing. Client: Sounds good, thanks." }),
        });
        return { success: true, data: { mock: true } };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Mock callback failed" };
      }
    },
  },
};

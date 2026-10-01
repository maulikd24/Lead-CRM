import type { IntegrationAdapter } from "@/lib/integrations/types";

interface ExotelCredentials {
  sid: string;
  apiKey: string;
  apiToken: string;
  callerId: string; // Exophone to call from
  webhookSecret?: string; // shared-secret query param the customer's callback URL is configured with
}

let creds: ExotelCredentials | null = null;

function baseUrl(): string {
  if (!creds) throw new Error("Exotel adapter not configured");
  return `https://${creds.apiKey}:${creds.apiToken}@api.exotel.com/v1/Accounts/${creds.sid}`;
}

// Same NEXTAUTH_URL -> VERCEL_URL fallback already used in send-sla-breach-email.ts — duplicated
// rather than shared, matching that file's own precedent for this exact 3-line helper.
function appBaseUrl(): string {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "";
}

export const exotelAdapter: IntegrationAdapter = {
  provider: "exotel",

  async configure(credentials) {
    creds = {
      sid: String(credentials.sid ?? ""),
      apiKey: String(credentials.apiKey ?? ""),
      apiToken: String(credentials.apiToken ?? ""),
      callerId: String(credentials.callerId ?? ""),
      webhookSecret: credentials.webhookSecret ? String(credentials.webhookSecret) : undefined,
    };
  },

  async testConnection() {
    try {
      const res = await fetch(`${baseUrl()}.json`);
      if (!res.ok) return { ok: false, message: `Exotel responded ${res.status}` };
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Connection failed" };
    }
  },

  // Exotel's callback URL has no built-in payload signing — the practical equivalent is a shared
  // secret baked into the callback URL itself as a query param (e.g. ...?secret=xxx), which the
  // route surfaces to us via the "x-webhook-query" header (see route.ts). Skipped (returns true)
  // when no secret is configured.
  verifySignature(headers) {
    if (!creds?.webhookSecret) return true;
    const query = new URLSearchParams(headers["x-webhook-query"] ?? "");
    return query.get("secret") === creds.webhookSecret;
  },

  async handleWebhook(payload) {
    const body = payload as {
      CallSid?: string;
      Status?: string;
      From?: string;
      Direction?: string;
      RecordingUrl?: string;
      DialCallDuration?: string;
    };
    const direction = body.Direction === "outbound-api" || body.Direction === "outbound-dial" ? "Outbound" : "Inbound";
    return [
      {
        type: "call_completed",
        clientPhone: body.From,
        payload: {
          callSid: body.CallSid,
          status: body.Status,
          direction,
          recordingUrl: body.RecordingUrl,
          durationSeconds: body.DialCallDuration ? Number(body.DialCallDuration) : undefined,
          message: `${direction} call ${body.Status ?? "completed"}`,
        },
      },
    ];
  },

  actions: {
    async initiateCall(client) {
      if (!client.mobile) return { success: false, error: "Client has no mobile number" };
      try {
        const form = new URLSearchParams({
          From: client.mobile,
          CallerId: creds?.callerId ?? "",
        });
        const res = await fetch(`${baseUrl()}/Calls/connect.json`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form,
        });
        if (!res.ok) {
          return { success: false, error: `Exotel responded ${res.status}: ${await res.text()}` };
        }
        const data = await res.json();
        return { success: true, data };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Request failed" };
      }
    },

    // Triggers Exotel's ExoVoiceAnalyze to transcribe a completed call's recording. Results arrive
    // asynchronously at the callback_url (src/app/api/internal/exotel/voice-analyze-callback/route.ts),
    // authenticated the same shared-secret-via-query-param way verifySignature already checks above.
    // Exotel's exact callback JSON schema is not published — see that route for the defensive parsing
    // this requires; this action only needs to know the request shape, which the ExoVoiceAnalyze API
    // reference does document.
    async triggerVoiceAnalysis(_client, params) {
      const callSid = String(params.callSid ?? "");
      const activityId = String(params.activityId ?? "");
      if (!callSid || !activityId) return { success: false, error: "triggerVoiceAnalysis requires callSid and activityId" };
      try {
        const callbackUrl = `${appBaseUrl()}/api/internal/exotel/voice-analyze-callback?secret=${encodeURIComponent(creds?.webhookSecret ?? "")}&activityId=${encodeURIComponent(activityId)}`;
        const form = new URLSearchParams({ task_id: activityId, callback_url: callbackUrl, insight_tasks: "transcript" });
        const res = await fetch(`${baseUrl()}/Calls/${callSid}/ExoVoiceAnalyze.json`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form,
        });
        if (!res.ok) {
          return { success: false, error: `Exotel responded ${res.status}: ${await res.text()}` };
        }
        return { success: true, data: await res.json().catch(() => undefined) };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Request failed" };
      }
    },
  },
};

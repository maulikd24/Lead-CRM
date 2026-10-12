import { safeEqual } from "@/lib/security/webhook-auth";
import type { IntegrationAdapter } from "@/lib/integrations/types";

interface ExotelCredentials {
  sid: string;
  apiKey: string;
  apiToken: string;
  callerId: string; // Exophone to call from
  webhookSecret?: string; // shared-secret query param the customer's callback URL is configured with
}

let creds: ExotelCredentials | null = null;

// Credentials travel in the Authorization header, never in the URL, so they cannot end up in
// logged URLs or fetch error messages.
function baseUrl(): string {
  if (!creds) throw new Error("Exotel adapter not configured");
  return `https://api.exotel.com/v1/Accounts/${creds.sid}`;
}

function authHeaders(): Record<string, string> {
  if (!creds) throw new Error("Exotel adapter not configured");
  return { Authorization: "Basic " + Buffer.from(`${creds.apiKey}:${creds.apiToken}`).toString("base64") };
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
      const res = await fetch(`${baseUrl()}.json`, { headers: authHeaders() });
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
  // Exotel can't sign callbacks, so the secret rides in the configured callback URL. Fails closed when unset.
  verifySignature(headers) {
    const query = new URLSearchParams(headers["x-webhook-query"] ?? "");
    return safeEqual(query.get("secret"), creds?.webhookSecret);
  },

  async handleWebhook(payload) {
    const body = payload as {
      CallSid?: string;
      Status?: string;
      From?: string;
      To?: string;
      Direction?: string;
      EventType?: string;
      RecordingUrl?: string;
      DialCallDuration?: string;
      ConversationDuration?: string;
    };
    const direction = body.Direction === "outbound-api" || body.Direction === "outbound-dial" ? "Outbound" : "Inbound";
    // A click-to-call (Calls/connect) rings our user first (From) and then the client (To); every other call's client is From.
    const clientPhone = body.Direction === "outbound-api" && body.To ? body.To : body.From;
    // Click-to-call also reports the moment the client answers — the live call widget's cue, not a finished call.
    if (body.EventType === "answered") {
      return [{ type: "call_answered", clientPhone, payload: { callSid: body.CallSid, status: "in-progress" } }];
    }
    const duration = body.ConversationDuration ?? body.DialCallDuration;
    return [
      {
        type: "call_completed",
        clientPhone,
        payload: {
          callSid: body.CallSid,
          status: body.Status,
          direction,
          recordingUrl: body.RecordingUrl,
          durationSeconds: duration ? Number(duration) : undefined,
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
          headers: { ...authHeaders(), "Content-Type": "application/x-www-form-urlencoded" },
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

    /**
     * Click-to-call: Exotel rings the user's own phone (agentPhone) and, once they pick up, connects the client (customerPhone),
     * showing the firm's Exophone as caller ID. Exotel reports "answered" and the final status to our Exotel webhook.
     */
    async clickToCall(_client, params) {
      const agentPhone = String(params.agentPhone ?? "");
      const customerPhone = String(params.customerPhone ?? "");
      if (!agentPhone || !customerPhone) return { success: false, error: "clickToCall requires agentPhone and customerPhone" };
      try {
        const form = new URLSearchParams({ From: agentPhone, To: customerPhone, CallerId: creds?.callerId ?? "", Record: params.record ? "true" : "false" });
        // Exotel posts back to our webhook with the shared secret in the URL — the same check as every other Exotel callback.
        if (creds?.webhookSecret && appBaseUrl()) {
          form.set("StatusCallback", `${appBaseUrl()}/api/webhooks/exotel?secret=${encodeURIComponent(creds.webhookSecret)}`);
          form.append("StatusCallbackEvents[0]", "terminal");
          form.append("StatusCallbackEvents[1]", "answered");
        }
        const res = await fetch(`${baseUrl()}/Calls/connect.json`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form,
        });
        if (!res.ok) return { success: false, error: `Exotel responded ${res.status}: ${await res.text()}` };
        const data = (await res.json()) as { Call?: { Sid?: string } };
        if (!data.Call?.Sid) return { success: false, error: "Exotel did not return a call id" };
        return { success: true, data: { callSid: data.Call.Sid } };
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
          headers: { ...authHeaders(), "Content-Type": "application/x-www-form-urlencoded" },
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

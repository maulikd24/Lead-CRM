import type { IntegrationAdapter } from "@/lib/integrations/types";

interface FreshdeskCredentials {
  domain: string; // e.g. "yourcompany" for yourcompany.freshdesk.com
  apiKey: string;
  webhookSecret?: string; // shared-secret header value the customer's Automation Rule sends back
}

let creds: FreshdeskCredentials | null = null;

function baseUrl(): string {
  if (!creds) throw new Error("Freshdesk adapter not configured");
  return `https://${creds.domain}.freshdesk.com/api/v2`;
}

function authHeader(): string {
  if (!creds) throw new Error("Freshdesk adapter not configured");
  return "Basic " + Buffer.from(`${creds.apiKey}:X`).toString("base64");
}

export type FreshdeskChannel = "Email" | "Live Chat" | "WhatsApp" | "Other";

// Best-effort — Freshdesk's numeric ticket "source" codes vary by plan/Omnichannel configuration.
// Adjust once real webhook deliveries are seen. A readable string (see normalizeFreshdeskChannel)
// sent directly by the Automation Rule's payload template avoids needing this table at all.
const FRESHDESK_SOURCE_CODE_CHANNEL: Record<string, FreshdeskChannel> = {
  "1": "Email",
  "7": "Live Chat",
  "1038": "WhatsApp", // placeholder Omnichannel/WhatsApp source code — verify against your instance
};

export function normalizeFreshdeskChannel(raw: string | number | undefined): FreshdeskChannel {
  if (raw === undefined || raw === null) return "Other";
  const asString = String(raw).trim().toLowerCase();
  if (asString.includes("whatsapp")) return "WhatsApp";
  if (asString.includes("chat")) return "Live Chat";
  if (asString.includes("email") || asString.includes("mail")) return "Email";
  return FRESHDESK_SOURCE_CODE_CHANNEL[String(raw).trim()] ?? "Other";
}

export const freshdeskAdapter: IntegrationAdapter = {
  provider: "freshdesk",

  async configure(credentials) {
    creds = {
      domain: String(credentials.domain ?? ""),
      apiKey: String(credentials.apiKey ?? ""),
      webhookSecret: credentials.webhookSecret ? String(credentials.webhookSecret) : undefined,
    };
  },

  async testConnection() {
    try {
      const res = await fetch(`${baseUrl()}/tickets?per_page=1`, {
        headers: { Authorization: authHeader() },
      });
      if (!res.ok) return { ok: false, message: `Freshdesk responded ${res.status}` };
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Connection failed" };
    }
  },

  // Freshdesk's Automation-rule webhooks don't sign payloads (no HMAC support) — the practical
  // equivalent is a shared-secret custom header the customer configures on the webhook action
  // itself. Skipped (returns true) when no secret is configured, so this stays a no-op until an
  // Admin actually sets one in Settings > Apps & Integrations.
  verifySignature(headers) {
    if (!creds?.webhookSecret) return true;
    return headers["x-webhook-secret"] === creds.webhookSecret;
  },

  async handleWebhook(payload) {
    const body = payload as {
      ticket_id?: number;
      status?: string;
      channel?: string; // preferred: a readable label if the Automation Rule sends {{ticket.source}} as text
      source?: number | string; // fallback: Freshdesk's numeric source code
      requester_name?: string;
      requester_email?: string;
      requester_phone?: string;
      subject?: string;
      description?: string;
    };

    const channel = normalizeFreshdeskChannel(body.channel ?? body.source);

    return [
      {
        type: "ticket_created",
        clientPhone: body.requester_phone,
        clientEmail: body.requester_email,
        payload: {
          ticketId: body.ticket_id,
          status: body.status,
          channel,
          requesterName: body.requester_name,
          subject: body.subject,
          description: body.description,
          message: `New ${channel} ticket via Freshdesk: ${body.subject ?? "(no subject)"}`,
        },
      },
    ];
  },

  actions: {
    async createTicket(client, params) {
      try {
        const res = await fetch(`${baseUrl()}/tickets`, {
          method: "POST",
          headers: { Authorization: authHeader(), "Content-Type": "application/json" },
          body: JSON.stringify({
            email: client.email ?? undefined,
            subject: params.subject ?? `Support request for ${client.name}`,
            description: params.description ?? `Ticket created from Supportify for client ${client.name}`,
            priority: params.priority ?? 1,
            status: 2, // open
          }),
        });
        if (!res.ok) {
          return { success: false, error: `Freshdesk responded ${res.status}: ${await res.text()}` };
        }
        const data = await res.json();
        return { success: true, data };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Request failed" };
      }
    },
  },
};

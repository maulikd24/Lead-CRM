import type { IntegrationAdapter, NormalizedEvent, SupportTicketData, TicketSource } from "@/lib/integrations/types";
import { RateLimitedError } from "@/lib/integrations/types";
import { safeEqual } from "@/lib/security/webhook-auth";

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

export type FreshdeskChannel = "Email" | "Live Chat" | "WhatsApp" | "Phone" | "Portal" | "Other";

// Freshdesk's numeric ticket "source" codes (API v2). Omnichannel/WhatsApp codes vary by account — a readable
// {{ticket.source}} label sent by the Automation Rule (see normalizeFreshdeskChannel) avoids needing them.
const FRESHDESK_SOURCE_CODE_CHANNEL: Record<string, FreshdeskChannel> = {
  "1": "Email",
  "2": "Portal",
  "3": "Phone",
  "7": "Live Chat",
  "10": "Email", // outbound email
  "1038": "WhatsApp", // placeholder Omnichannel/WhatsApp source code — verify against your instance
};

export function normalizeFreshdeskChannel(raw: string | number | undefined | null): FreshdeskChannel {
  if (raw === undefined || raw === null) return "Other";
  const asString = String(raw).trim().toLowerCase();
  if (asString.includes("whatsapp")) return "WhatsApp";
  if (asString.includes("chat")) return "Live Chat";
  if (asString.includes("email") || asString.includes("mail")) return "Email";
  if (asString.includes("phone") || asString.includes("call")) return "Phone";
  if (asString.includes("portal")) return "Portal";
  return FRESHDESK_SOURCE_CODE_CHANNEL[String(raw).trim()] ?? "Other";
}

const STATUS_LABELS: Record<string, string> = { "2": "Open", "3": "Pending", "4": "Resolved", "5": "Closed", "6": "Waiting on Customer", "7": "Waiting on Third Party" };
const PRIORITY_LABELS: Record<string, string> = { "1": "Low", "2": "Medium", "3": "High", "4": "Urgent" };

/** Freshdesk sends codes from the API and labels from Automation-rule placeholders — store labels either way. */
function label(map: Record<string, string>, raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const value = String(raw).trim();
  return map[value] ?? value;
}

function toDate(raw: unknown): Date | null {
  if (!raw) return null;
  const date = new Date(String(raw));
  return Number.isNaN(date.getTime()) ? null : date;
}

type FreshdeskWebhookBody = {
  event?: string; // "created" | "updated" — which Automation Rule fired
  ticket_id?: number | string;
  status?: string;
  priority?: string;
  channel?: string; // preferred: a readable label ({{ticket.source}})
  source?: number | string; // fallback: Freshdesk's numeric source code
  requester_name?: string;
  requester_email?: string;
  requester_phone?: string;
  requester_mobile?: string;
  subject?: string;
  created_at?: string;
  updated_at?: string;
};

/** Shared by the live and mock adapters, so local/Preview testing exercises the real parsing. */
export function parseFreshdeskWebhook(payload: unknown): NormalizedEvent[] {
  const body = payload as FreshdeskWebhookBody;
  const channel = normalizeFreshdeskChannel(body.channel ?? body.source);
  const isUpdate = String(body.event ?? "").toLowerCase().startsWith("update");
  const ticket: SupportTicketData | null =
    body.ticket_id !== undefined && body.ticket_id !== null && String(body.ticket_id).trim() !== ""
      ? {
          externalId: String(body.ticket_id).trim(),
          subject: body.subject?.trim() || null,
          status: label(STATUS_LABELS, body.status),
          priority: label(PRIORITY_LABELS, body.priority),
          channel,
          createdAt: toDate(body.created_at),
          updatedAt: toDate(body.updated_at),
        }
      : null;

  return [
    {
      type: isUpdate ? "ticket_updated" : "ticket_created",
      clientPhone: body.requester_phone?.trim() || body.requester_mobile?.trim() || undefined,
      clientEmail: body.requester_email?.trim() || undefined,
      payload: {
        ticketId: ticket?.externalId,
        status: ticket?.status,
        channel,
        requesterName: body.requester_name,
        subject: body.subject,
        ticket,
      },
    },
  ];
}

class FreshdeskApiError extends Error {}

async function fdGet<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, { headers: { Authorization: authHeader() } });
  if (res.status === 429) throw new RateLimitedError(Number(res.headers.get("retry-after")) || 60);
  if (!res.ok) throw new FreshdeskApiError(`Freshdesk responded ${res.status} for ${path.split("?")[0]}`);
  return res.json() as Promise<T>;
}

type FreshdeskTicket = { id: number; subject?: string; status?: number; priority?: number; source?: number; created_at?: string; updated_at?: string };

export function mapFreshdeskTicket(t: FreshdeskTicket): SupportTicketData {
  return {
    externalId: String(t.id),
    subject: t.subject ?? null,
    status: label(STATUS_LABELS, t.status),
    priority: label(PRIORITY_LABELS, t.priority),
    channel: normalizeFreshdeskChannel(t.source),
    createdAt: toDate(t.created_at),
    updatedAt: toDate(t.updated_at),
  };
}

const MAX_TICKET_PAGES = 50; // 5,000 tickets per contact — far beyond any real customer

const freshdeskTickets: TicketSource = {
  async findContactIds({ phones, email }) {
    // One search call covers every stored format of the number (Freshdesk matches phone fields exactly) plus email.
    const quote = (v: string) => `'${v.replace(/'/g, "")}'`;
    const clauses = [...phones.flatMap((p) => [`phone:${quote(p)}`, `mobile:${quote(p)}`]), ...(email ? [`email:${quote(email)}`] : [])];
    if (clauses.length === 0) return [];
    const data = await fdGet<{ results?: { id: number }[] }>(`/search/contacts?query=${encodeURIComponent(`"${clauses.join(" OR ")}"`)}`);
    return [...new Set((data.results ?? []).map((c) => String(c.id)))];
  },

  async listTicketsForContact(contactId) {
    const tickets: SupportTicketData[] = [];
    // Without updated_since Freshdesk only lists the last 30 days — this pulls the contact's whole history.
    for (let page = 1; page <= MAX_TICKET_PAGES; page++) {
      const batch = await fdGet<FreshdeskTicket[]>(
        `/tickets?requester_id=${encodeURIComponent(contactId)}&updated_since=2000-01-01T00:00:00Z&per_page=100&page=${page}`,
      );
      tickets.push(...batch.map(mapFreshdeskTicket));
      if (batch.length < 100) break;
    }
    return tickets;
  },

  ticketUrl(externalId) {
    return creds?.domain ? `https://${creds.domain}.freshdesk.com/a/tickets/${externalId}` : null;
  },
};

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
  // itself. Fails closed: with no secret configured, every webhook is rejected.
  verifySignature(headers) {
    return safeEqual(headers["x-webhook-secret"], creds?.webhookSecret);
  },

  async handleWebhook(payload) {
    return parseFreshdeskWebhook(payload);
  },

  tickets: freshdeskTickets,

  actions: {
    async createTicket(client, params) {
      // Freshdesk needs a requester: email when we have one, otherwise the phone (with a name).
      const requester = client.email ? { email: client.email } : client.mobile ? { phone: client.mobile, name: client.name } : null;
      if (!requester) return { success: false, error: "The client has no email or phone to raise a Freshdesk ticket for" };
      try {
        const res = await fetch(`${baseUrl()}/tickets`, {
          method: "POST",
          headers: { Authorization: authHeader(), "Content-Type": "application/json" },
          body: JSON.stringify({
            ...requester,
            subject: params.subject ?? `Support request for ${client.name}`,
            description: params.description ?? `Ticket created from Supportify for client ${client.name}`,
            priority: params.priority ?? 1,
            status: 2, // open
          }),
        });
        if (!res.ok) {
          return { success: false, error: `Freshdesk responded ${res.status}: ${await res.text()}` };
        }
        const data = (await res.json()) as FreshdeskTicket;
        return { success: true, data: { ...data, ticket: mapFreshdeskTicket(data) } };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Request failed" };
      }
    },
  },
};

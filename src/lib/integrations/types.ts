import type { Client } from "@/generated/prisma/client";

export interface NormalizedEvent {
  type: string;
  clientPhone?: string;
  clientEmail?: string;
  /** CleverTap identity when it is an app user id (opaque id). Used only to find the customer; never stored. */
  appUserId?: string;
  /** Raw external task/issue ID (e.g. ClickUp task ID, Jira issue key) — links to Task.externalId. */
  externalTaskId?: string;
  /** Client.clientCode, for providers (e.g. Jira) where the external record links to a client but wasn't created by Supportify. */
  clientCode?: string;
  payload: Record<string, unknown>;
}

export interface ActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/** A helpdesk ticket as Supportify stores it (SupportTicket) — labels, not provider codes. */
export interface SupportTicketData {
  externalId: string;
  subject?: string | null;
  status?: string | null;
  priority?: string | null;
  channel?: string | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

/** The helpdesk is rate-limiting us: stop this run and try again later. */
export class RateLimitedError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`Rate limited — retry after ${retryAfterSeconds}s`);
  }
}

/** Read access to a helpdesk's ticket history (Freshdesk). */
export interface TicketSource {
  /** Helpdesk contact ids whose phone/mobile matches any of `phones` or whose email is `email`. */
  findContactIds(input: { phones: string[]; email: string | null }): Promise<string[]>;
  /** Every ticket ever raised by this contact (not just recent ones). */
  listTicketsForContact(contactId: string): Promise<SupportTicketData[]>;
  /** Link to open the ticket in the helpdesk, or null when unknown (mock). */
  ticketUrl(externalId: string): string | null;
}

export interface IntegrationAdapter {
  provider: string;
  configure(credentials: Record<string, unknown>, settings: Record<string, unknown>): Promise<void>;
  testConnection(): Promise<{ ok: boolean; message?: string }>;
  /** Required, and must fail closed: return false when no secret is configured. The webhook route rejects a
   * request before parsing it unless this returns true. */
  verifySignature(headers: Record<string, string>, rawBody: string): boolean;
  handleWebhook(payload: unknown, headers: Record<string, string>): Promise<NormalizedEvent[]>;
  /** Ticket history, for helpdesk providers (Freshdesk). */
  tickets?: TicketSource;
  actions: Record<string, (client: Client, params: Record<string, unknown>) => Promise<ActionResult>>;
}

/**
 * Transactional email to internal Users (Admins/RMs) — distinct from IntegrationAdapter
 * (webhooks/per-client actions) and MessagingAdapter (client-facing WhatsApp/SMS).
 */
export interface EmailAdapter {
  provider: string;
  configure(credentials: Record<string, unknown>, settings: Record<string, unknown>): Promise<void>;
  sendEmail(params: { to: string[]; subject: string; html: string; text?: string }): Promise<ActionResult>;
}

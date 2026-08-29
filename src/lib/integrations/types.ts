import type { Client } from "@/generated/prisma/client";

export interface NormalizedEvent {
  type: string;
  clientPhone?: string;
  clientEmail?: string;
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

export interface IntegrationAdapter {
  provider: string;
  configure(credentials: Record<string, unknown>, settings: Record<string, unknown>): Promise<void>;
  testConnection(): Promise<{ ok: boolean; message?: string }>;
  verifySignature?(headers: Record<string, string>, rawBody: string): boolean;
  handleWebhook(payload: unknown, headers: Record<string, string>): Promise<NormalizedEvent[]>;
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

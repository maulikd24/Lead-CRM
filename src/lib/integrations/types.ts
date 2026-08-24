import type { Client } from "@/generated/prisma/client";

export interface NormalizedEvent {
  type: string;
  clientPhone?: string;
  clientEmail?: string;
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

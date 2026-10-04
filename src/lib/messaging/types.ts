import type { MessageStatus } from "@/generated/prisma/client";

export interface InboundMessage {
  externalId: string;
  fromPhone: string;
  body: string;
  receivedAt: Date;
}

export interface MessagingAdapter {
  channel: "whatsapp" | "sms";
  provider: string;
  configure(credentials: Record<string, unknown>, settings: Record<string, unknown>): Promise<void>;
  sendMessage(params: {
    to: string;
    body: string;
    templateExternalId?: string | null;
    variables: Record<string, string>;
  }): Promise<{ externalId: string; status: MessageStatus }>;
  /** Authenticates an inbound webhook before it is parsed. Must fail closed (false when no secret is configured).
   * headers includes "x-webhook-query" = the raw query string, for providers that pass a secret in the URL. */
  verifyWebhook(headers: Record<string, string>, rawBody: string): boolean;
  handleInboundWebhook(payload: unknown): Promise<InboundMessage[]>;
  handleStatusWebhook(payload: unknown): Promise<{ externalId: string; status: MessageStatus }[]>;
}

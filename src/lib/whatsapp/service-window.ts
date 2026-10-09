/**
 * WhatsApp's customer-service window (Meta Cloud API only): free-form messages are allowed for 24 hours after the
 * customer's last inbound message; after that only an approved template may start the conversation again.
 * WhatsApp-Web style accounts (the linked-device multi-account inbox) are not subject to this rule, so for them
 * templateRequired is always false. See docs/agents.md.
 */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const META_PROVIDER = "whatsapp_meta";

export function isWithinServiceWindow(lastInboundAt: Date | null | undefined, now: Date): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() < SERVICE_WINDOW_MS;
}

/** `provider` is the Message.provider string of the conversation's account/transport. */
export function usesServiceWindow(account: { provider?: string | null }): boolean {
  return account.provider === META_PROVIDER;
}

export function templateRequired(account: { provider?: string | null }, lastInboundAt: Date | null | undefined, now: Date): boolean {
  return usesServiceWindow(account) && !isWithinServiceWindow(lastInboundAt, now);
}

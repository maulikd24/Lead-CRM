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

/**
 * Enforcement (composer restriction and the send refusal) is behind WA_META_WINDOW=1, default off. Reason: WhatsAppAccount carries
 * no provider field today, so the provider of the account a reply leaves from cannot be determined, and every inbox account is a
 * linked-device one for which the rule does not apply. Once accounts carry a provider, accountProvider() picks it up with no change
 * here, and the flag can be switched on.
 */
export function metaWindowEnforced(env: Record<string, string | undefined> = process.env): boolean {
  return env.WA_META_WINDOW === "1";
}

/** The provider of the account a reply will go out on, when the account carries one; null otherwise. */
export function accountProvider(account: object | null | undefined): string | null {
  const p = (account as { provider?: string | null } | null | undefined)?.provider;
  return typeof p === "string" ? p : null;
}

export const WINDOW_CLOSED_MESSAGE = "The 24-hour WhatsApp window has closed. Send an approved template instead.";

export function windowBlockReason(input: { enforced: boolean; provider: string | null; lastInboundAt: Date | null; now: Date }): string | null {
  return input.enforced && templateRequired({ provider: input.provider }, input.lastInboundAt, input.now) ? WINDOW_CLOSED_MESSAGE : null;
}

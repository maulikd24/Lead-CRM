import { emitCampaignConversionFailed, emitCampaignConversionSent } from "@/lib/events/producers-emit";

import type { DrainDeps } from "./drain";

/**
 * Send results as canonical events (campaign.conversion.sent, campaign.conversion.failed), through the one emit() path: flagged by CUSTOMER_EVENTS_ENABLED,
 * idempotent on the outbox row, correlated on the customer's flow. Codes only: never the hashed identifiers, a value or a response body. Never throws.
 */
export const reportResultAsEvent: NonNullable<DrainDeps["onResult"]> = async (row, res) => {
  if (res.kind === "sent") await emitCampaignConversionSent({ clientId: row.clientId, outboxId: row.id, provider: row.destination, eventKind: row.eventType, matched: res.matched, sentAt: row.sentAt ?? new Date() });
  else await emitCampaignConversionFailed({ clientId: row.clientId, outboxId: row.id, provider: row.destination, eventKind: row.eventType, errorClass: res.errorCode, occurredAt: new Date() });
};

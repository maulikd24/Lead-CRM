import type { EventConsumer } from "@/lib/events/consumers";
import type { EmitInput } from "@/lib/events/envelope";
import { emitEvent } from "@/lib/events/emit-db";
import { customerEventsEnabled } from "@/lib/events/flag";
import { buildCampaignFundedAttributed } from "@/lib/events/producers";
import { emitCampaignLeadPushed, emitCampaignLeadSlaBreached, emitSpeedToContactMeasured } from "@/lib/events/producers-emit";

import { attributionEnabled } from "./flag";
import type { PushEvents, SweepEvents } from "./lead-push";
import type { Attribution } from "./model";

/**
 * Attribution's side of the one event path. Everything goes through emit() (flagged by CUSTOMER_EVENTS_ENABLED, idempotent, correlated on the customer's
 * flow id); nothing here writes a second event table. Events are facts about what happened to a lead (pushed, breached, reached, funded), never a copy of
 * the lead's answers: the registry strips anything that is not an id, a number or an enum.
 */

export const pushEvents: PushEvents = {
  pushed: (e) => emitCampaignLeadPushed({ clientId: e.clientId, pushId: e.pushId, slaMinutes: e.slaMinutes, assigned: e.assigned, campaignId: e.campaignId, occurredAt: e.occurredAt }),
};

export const sweepEvents: SweepEvents = {
  contacted: (push, at, minutes) => emitSpeedToContactMeasured({ clientId: push.clientId, pushId: push.id, minutes, contactedAt: at }),
  breached: (push, minutesPastSla) => emitCampaignLeadSlaBreached({ clientId: push.clientId, pushId: push.id, slaMinutes: push.slaMinutes, minutesPastSla }),
};

export type FundedDeps = {
  enabled: () => boolean;
  attribution: (clientId: string) => Promise<Attribution | null>;
  emit: (input: EmitInput | null) => Promise<void>;
};

const defaultFundedDeps = (): FundedDeps => ({
  enabled: () => attributionEnabled() && customerEventsEnabled(),
  attribution: async (clientId) => (await (await import("./db")).loadClientJourney(clientId))?.attribution ?? null,
  emit: async (input) => void (input && (await emitEvent(input))),
});

/**
 * A customer just reached a funded status: when their FIRST touch names a campaign, record the campaign outcome as a fact (campaign.funded.attributed,
 * once per customer). Called right after account.funded by the stage engine. Best effort: it never throws into the funding transition and costs nothing
 * while either flag is off (no attribution lookup is made).
 */
export async function emitCampaignFundedFor(p: { clientId: string; status: string; fundedAt: Date }, deps: FundedDeps = defaultFundedDeps()): Promise<void> {
  try {
    if (p.status !== "FULLY_FUNDED" && p.status !== "PARTIALLY_FUNDED") return;
    if (!deps.enabled()) return;
    const attribution = await deps.attribution(p.clientId);
    const first = attribution?.status === "attributed" ? attribution.first : null;
    const campaignId = first?.campaign?.id;
    if (!first || !campaignId) return;
    await deps.emit(buildCampaignFundedAttributed({ clientId: p.clientId, campaignId, provider: first.kind, confidence: first.confidence, fundedAt: p.fundedAt, fundedStatus: p.status }));
  } catch {
    // The funding transition must never fail because an event could not be built or stored.
  }
}

/** Closes the speed-to-lead clock the moment an event says a person reached the customer. Idempotent, no outbound effect, safe to replay. */
export const leadClockConsumer = (close: (clientId: string) => Promise<number>): EventConsumer => ({
  name: "attribution-lead-clock",
  types: ["lead.contacted", "call.logged", "whatsapp.message.sent"],
  sideEffects: "none",
  async handle(event) {
    if (!event.clientId) return;
    await close(event.clientId);
  },
});

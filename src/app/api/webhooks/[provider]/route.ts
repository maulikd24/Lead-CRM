import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { getAdapter, isMockAdapter } from "@/lib/integrations/registry";
import { isProductionRuntime } from "@/lib/security/webhook-auth";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { claimWebhookDelivery, deliveryKey, releaseWebhookDelivery } from "@/lib/security/webhook-dedupe";
import { logActivity } from "@/lib/activities/log-activity";
import { onEvent } from "@/lib/journeys/dispatch";
import { handleExternalTaskEvent } from "@/lib/integrations/task-sync";
import { resolveInboundClient } from "@/lib/clients/inbound-contact";
import { findClientByIdentity } from "@/lib/clients/identity";
import { upsertSupportTicket } from "@/lib/support/tickets";
import type { SupportTicketData } from "@/lib/integrations/types";
import type { Client } from "@/generated/prisma/client";
import { appIdLinkingEnabled, findClientIdByAppUserId, resolveLiveClientId } from "@/lib/integrations/clevertap/identity";
import { maybeHandleHandoff } from "@/lib/integrations/freshdesk/deps";

const ACTIVITY_TYPE_BY_EVENT: Record<string, "CALL" | "TICKET" | "MESSAGE"> = {
  call_completed: "CALL",
  ticket_created: "TICKET",
  ticket_updated: "TICKET",
  campaign_event: "MESSAGE",
};

// leadSource for a brand-new client created from an inbound event, keyed by the channel label the
// Freshdesk adapter normalizes to (normalizeFreshdeskChannel) — falls back to the raw provider
// name for anything else (e.g. Exotel calls, which have no "channel" concept of their own).
const CHANNEL_LEAD_SOURCE: Record<string, string> = {
  Email: "Email",
  "Live Chat": "Live Chat",
  WhatsApp: "WhatsApp",
};

const LEAD_CREATING_PROVIDERS = new Set(["freshdesk", "exotel"]);

// Generous per-IP ceiling: providers deliver from a handful of IPs, so this only bites on floods.
const WEBHOOK_RATE_LIMIT = { limit: 300, windowSeconds: 60 };

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;

  const limited = await rateLimit(`webhook:${provider}`, clientIp(request), WEBHOOK_RATE_LIMIT);
  if (!limited.allowed) return tooManyRequests(limited);

  let adapter;
  try {
    adapter = await getAdapter(provider);
  } catch {
    return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 404 });
  }
  // Mock adapters (any provider not switched to live) authenticate nothing — never accept them in Production.
  if (isMockAdapter(adapter) && isProductionRuntime()) {
    return NextResponse.json({ error: `Integration not enabled: ${provider}` }, { status: 404 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  const rawBody = await request.text();

  const headers = Object.fromEntries(request.headers.entries());
  // Exotel's shared secret travels as a query param on the customer's own configured callback URL
  // (it has no header-signing option) — surface the raw query string to the adapter under a
  // synthetic header key rather than teaching every adapter about the Request object directly.
  headers["x-webhook-query"] = new URL(request.url).search.replace(/^\?/, "");

  // Authenticate before parsing anything. Adapters fail closed when no secret is configured.
  if (!adapter.verifySignature(headers, rawBody)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = contentType.includes("application/json") ? JSON.parse(rawBody || "{}") : Object.fromEntries(new URLSearchParams(rawBody));
  } catch {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }

  // A provider retry of a delivery we already processed is acknowledged, not processed again.
  const eventKey = deliveryKey(rawBody);
  if (!(await claimWebhookDelivery(provider, eventKey))) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    // AI hand-off tickets (FRESHDESK_HANDOFF_ENABLED=1 only; null otherwise, so nothing else changes).
    const handoff = await maybeHandleHandoff(provider, payload);
    if (handoff) return NextResponse.json({ ok: true, handoff: handoff.status });
    const processed = await processEvents(provider, adapter, payload, headers);
    return NextResponse.json({ ok: true, eventsProcessed: processed });
  } catch (error) {
    // Release the claim so the provider's retry is processed rather than skipped as a duplicate.
    await releaseWebhookDelivery(provider, eventKey);
    throw error;
  }
}

async function processEvents(provider: string, adapter: Awaited<ReturnType<typeof getAdapter>>, payload: unknown, headers: Record<string, string>): Promise<number> {
  const events = await adapter.handleWebhook(payload, headers);

  for (const event of events) {
    if (event.externalTaskId) {
      await handleExternalTaskEvent(provider, event);
      continue;
    }

    // A known Freshdesk ticket stays with the client it's already on (status updates follow the ticket, even if the
    // requester's details have changed since).
    const ticket = provider === "freshdesk" ? ((event.payload.ticket as SupportTicketData | null | undefined) ?? null) : null;
    let client: Client | null = null;
    if (ticket) {
      const known = await prisma.supportTicket.findUnique({
        where: { provider_externalId: { provider, externalId: ticket.externalId } },
        include: { client: true },
      });
      if (known && !known.client.isDeleted && !known.client.mergedIntoId) client = known.client;
    }

    // An app user id (CleverTap identity) is looked up in the signup ledger, following merges to the surviving customer.
    // APP_USER_ID_LINKING=1 only; phone and email below stay the fallback. Nothing is ever created from an opaque id.
    if (!client && event.appUserId && appIdLinkingEnabled()) {
      const linkedId = await findClientIdByAppUserId(prisma, event.appUserId);
      const liveId = linkedId ? await resolveLiveClientId(prisma, linkedId) : null;
      if (liveId) client = await prisma.client.findUnique({ where: { id: liveId } });
    }

    if (!client) {
      if (!event.clientPhone && !event.clientEmail) continue; // nothing to key on
      if (LEAD_CREATING_PROVIDERS.has(provider)) {
        // The shared identity rule (src/lib/clients/identity.ts): matches on any phone format or email, fills in a
        // missing detail, flags phone/email conflicts, and only creates a lead when nobody matches.
        const channel = typeof event.payload.channel === "string" ? event.payload.channel : undefined;
        const requesterName = typeof event.payload.requesterName === "string" ? event.payload.requesterName : undefined;
        const resolved = await resolveInboundClient({
          phone: event.clientPhone,
          email: event.clientEmail,
          name: requesterName,
          leadSource: (channel && CHANNEL_LEAD_SOURCE[channel]) || (provider === "exotel" ? "Inbound Call" : provider),
        });
        client = resolved.client;
      } else {
        // Engagement/task tools (Clevertap campaign events, Jira, ClickUp) only ever annotate a client we already
        // know — a campaign event for an unknown address must not silently create a junk lead.
        const { match } = await findClientByIdentity({ phone: event.clientPhone, email: event.clientEmail });
        if (!match) continue;
        client = await prisma.client.findUniqueOrThrow({ where: { id: match.id } });
      }
    }

    if (ticket) {
      // One timeline entry per ticket: created on first sighting, updated in place on every status change after.
      const { isNew } = await upsertSupportTicket(client.id, provider, ticket, "webhook");
      if (isNew) await onEvent("webhook_received", client.id);
      continue;
    }

    const activityType = event.payload.channel === "WhatsApp" ? "MESSAGE" : (ACTIVITY_TYPE_BY_EVENT[event.type] ?? "NOTE");

    const activity = await logActivity({
      clientId: client.id,
      type: activityType,
      payload: { source: provider, eventType: event.type, ...event.payload },
    });

    // Trigger call transcription (Exotel's ExoVoiceAnalyze) right after logging the call — best
    // effort, never blocks the webhook response. The async transcript arrives at
    // /api/internal/exotel/voice-analyze-callback, which runs the Claude quality-audit analysis.
    if (provider === "exotel" && event.type === "call_completed") {
      const callSid = typeof event.payload.callSid === "string" ? event.payload.callSid : undefined;
      if (callSid) {
        await prisma.conversationReview.create({
          data: { clientId: client.id, sourceType: "CALL", sourceActivityId: activity.id, exotelCallSid: callSid, assignedRmId: client.assignedToId, status: "PENDING_TRANSCRIPT" },
        });
        const result = await adapter.actions.triggerVoiceAnalysis(client, { callSid, activityId: activity.id });
        if (!result.success) console.error("Failed to trigger Exotel ExoVoiceAnalyze", result.error);
      }
    }

    // A newly-created client already had "client_created" dispatched once inside
    // createClientCore -> initializeClient — only fire the generic webhook trigger here, for both
    // new and existing clients, so a brand-new contact isn't double-enrolled into anything keyed
    // on "webhook_received" specifically.
    await onEvent("webhook_received", client.id);
  }

  return events.length;
}

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { getAdapter } from "@/lib/integrations/registry";
import { logActivity } from "@/lib/activities/log-activity";
import { onEvent } from "@/lib/journeys/dispatch";
import { handleExternalTaskEvent } from "@/lib/integrations/task-sync";
import { resolveInboundClient } from "@/lib/clients/inbound-contact";

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

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;

  let adapter;
  try {
    adapter = await getAdapter(provider);
  } catch {
    return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 404 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  const rawBody = await request.text();
  const payload = contentType.includes("application/json")
    ? JSON.parse(rawBody || "{}")
    : Object.fromEntries(new URLSearchParams(rawBody));

  const headers = Object.fromEntries(request.headers.entries());
  // Exotel's shared secret travels as a query param on the customer's own configured callback URL
  // (it has no header-signing option) — surface the raw query string to the adapter under a
  // synthetic header key rather than teaching every adapter about the Request object directly.
  headers["x-webhook-query"] = new URL(request.url).search.replace(/^\?/, "");

  if (adapter.verifySignature && !adapter.verifySignature(headers, rawBody)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const events = await adapter.handleWebhook(payload, headers);

  for (const event of events) {
    if (event.externalTaskId) {
      await handleExternalTaskEvent(provider, event);
      continue;
    }

    let client = event.clientPhone
      ? await prisma.client.findFirst({ where: { mobile: event.clientPhone, mergedIntoId: null, isDeleted: false } })
      : null;
    if (!client && event.clientEmail) {
      client = await prisma.client.findFirst({ where: { email: event.clientEmail, mergedIntoId: null, isDeleted: false } });
    }

    if (!client) {
      if (!event.clientPhone && !event.clientEmail) continue; // nothing to key on — unchanged behavior

      const channel = typeof event.payload.channel === "string" ? event.payload.channel : undefined;
      const requesterName = typeof event.payload.requesterName === "string" ? event.payload.requesterName : undefined;
      const resolved = await resolveInboundClient({
        phone: event.clientPhone,
        email: event.clientEmail,
        name: requesterName,
        leadSource: (channel && CHANNEL_LEAD_SOURCE[channel]) || (provider === "exotel" ? "Inbound Call" : provider),
      });
      client = resolved.client;
    }

    const activityType = event.payload.channel === "WhatsApp" ? "MESSAGE" : (ACTIVITY_TYPE_BY_EVENT[event.type] ?? "NOTE");

    await logActivity({
      clientId: client.id,
      type: activityType,
      payload: { source: provider, eventType: event.type, ...event.payload },
    });

    // A newly-created client already had "client_created" dispatched once inside
    // createClientCore -> initializeClient — only fire the generic webhook trigger here, for both
    // new and existing clients, so a brand-new contact isn't double-enrolled into anything keyed
    // on "webhook_received" specifically.
    await onEvent("webhook_received", client.id);
  }

  return NextResponse.json({ ok: true, eventsProcessed: events.length });
}

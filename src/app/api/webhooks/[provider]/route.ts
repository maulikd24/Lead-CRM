import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { getAdapter } from "@/lib/integrations/registry";
import { logActivity } from "@/lib/activities/log-activity";
import { onEvent } from "@/lib/journeys/dispatch";

const ACTIVITY_TYPE_BY_EVENT: Record<string, "CALL" | "TICKET" | "MESSAGE"> = {
  call_completed: "CALL",
  ticket_updated: "TICKET",
  campaign_event: "MESSAGE",
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
  const payload = contentType.includes("application/json")
    ? await request.json()
    : Object.fromEntries(new URLSearchParams(await request.text()));

  const headers = Object.fromEntries(request.headers.entries());

  const events = await adapter.handleWebhook(payload, headers);

  for (const event of events) {
    const client = event.clientPhone
      ? await prisma.client.findFirst({ where: { mobile: event.clientPhone } })
      : event.clientEmail
        ? await prisma.client.findFirst({ where: { email: event.clientEmail } })
        : null;

    if (!client) continue;

    await logActivity({
      clientId: client.id,
      type: ACTIVITY_TYPE_BY_EVENT[event.type] ?? "NOTE",
      payload: { source: provider, eventType: event.type, ...event.payload },
    });

    await onEvent("webhook_received", client.id);
  }

  return NextResponse.json({ ok: true, eventsProcessed: events.length });
}

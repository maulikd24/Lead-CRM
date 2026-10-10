import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { getMessagingAdapter, isMockMessagingAdapter } from "@/lib/messaging/registry";
import type { MessagingAdapter } from "@/lib/messaging/types";
import { isProductionRuntime, safeEqual } from "@/lib/security/webhook-auth";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { claimWebhookDelivery, deliveryKey, releaseWebhookDelivery } from "@/lib/security/webhook-dedupe";
import { logActivity } from "@/lib/activities/log-activity";
import { findClientByIdentity } from "@/lib/clients/identity";

type Channel = "whatsapp" | "sms";

function isChannel(value: string): value is Channel {
  return value === "whatsapp" || value === "sms";
}

/** Meta's webhook verification handshake (WhatsApp Cloud API). */
export async function GET(request: Request, { params }: { params: Promise<{ channel: string }> }) {
  const { channel } = await params;
  if (channel !== "whatsapp") return NextResponse.json({ error: "Not applicable" }, { status: 404 });

  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && safeEqual(token, process.env.META_WEBHOOK_VERIFY_TOKEN)) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

const WEBHOOK_RATE_LIMIT = { limit: 300, windowSeconds: 60 };

export async function POST(request: Request, { params }: { params: Promise<{ channel: string }> }) {
  const { channel } = await params;
  if (!isChannel(channel)) {
    return NextResponse.json({ error: `Unknown channel: ${channel}` }, { status: 404 });
  }

  const limited = await rateLimit(`webhook:messaging:${channel}`, clientIp(request), WEBHOOK_RATE_LIMIT);
  if (!limited.allowed) return tooManyRequests(limited);

  const adapter = await getMessagingAdapter(channel);
  // The mock adapter turns any {"from","text"} body into an inbound message — never accept it in Production.
  if (isMockMessagingAdapter(adapter) && isProductionRuntime()) {
    return NextResponse.json({ error: `Channel not enabled: ${channel}` }, { status: 404 });
  }

  const rawBody = await request.text();
  const headers = Object.fromEntries(request.headers.entries());
  headers["x-webhook-query"] = new URL(request.url).search.replace(/^\?/, "");
  // Authenticate before parsing (Meta: X-Hub-Signature-256; Exotel SMS: ?secret=). Fails closed.
  if (!adapter.verifyWebhook(headers, rawBody)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  let payload: unknown;
  try {
    payload = contentType.includes("application/json") ? JSON.parse(rawBody || "{}") : Object.fromEntries(new URLSearchParams(rawBody));
  } catch {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }

  const source = `messaging:${channel}`;
  const eventKey = deliveryKey(rawBody);
  if (!(await claimWebhookDelivery(source, eventKey))) {
    return NextResponse.json({ ok: true, duplicate: true });
  }
  try {
    return NextResponse.json(await processMessagingWebhook(channel, adapter, payload));
  } catch (error) {
    await releaseWebhookDelivery(source, eventKey);
    throw error;
  }
}

async function processMessagingWebhook(channel: Channel, adapter: MessagingAdapter, payload: unknown) {
  const [inbound, statuses] = await Promise.all([
    adapter.handleInboundWebhook(payload),
    adapter.handleStatusWebhook(payload),
  ]);

  for (const msg of inbound) {
    // Any phone format, live clients only (previously an exact match that could hit merged/archived clients).
    const { match } = await findClientByIdentity({ phone: msg.fromPhone });
    if (!match) continue;
    const client = { id: match.id, name: match.name, assignedToId: match.assignedToId };

    await prisma.message.create({
      data: {
        clientId: client.id,
        channel,
        provider: adapter.provider,
        direction: "INBOUND",
        body: msg.body,
        status: "DELIVERED",
        externalId: msg.externalId,
      },
    });

    await logActivity({
      clientId: client.id,
      type: "MESSAGE",
      payload: { direction: "INBOUND", channel, body: msg.body },
    });

    if (client.assignedToId) {
      await prisma.notification.create({
        data: {
          userId: client.assignedToId,
          type: "inbound_message",
          payload: { clientId: client.id, clientName: client.name, channel, preview: msg.body.slice(0, 140) },
        },
      });
    }
  }

  for (const status of statuses) {
    if (!status.externalId) continue;
    await prisma.message.updateMany({
      where: { externalId: status.externalId },
      data: { status: status.status },
    });
  }

  return { ok: true, inbound: inbound.length, statusUpdates: statuses.length };
}

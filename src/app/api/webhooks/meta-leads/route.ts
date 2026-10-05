import { NextResponse } from "next/server";

import { clientIp, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { safeEqual, verifyHmacSha256 } from "@/lib/security/webhook-auth";
import { getLeadIntakeConfig, intakeBlocked } from "@/lib/leads/config";
import { parseJsonBody, readCappedBody } from "@/lib/leads/http";
import { handleLeadgenChange, type LeadgenChange } from "@/lib/leads/meta";

/**
 * Meta Lead Ads (Facebook and Instagram) webhook — subscribe your Page to the `leadgen` field.
 *  GET  — Meta's verification handshake (hub.verify_token must match the configured token).
 *  POST — signed with X-Hub-Signature-256 (HMAC-SHA256 of the raw body using the app secret); carries only lead ids,
 *         so each lead is fetched from the Graph API with the page access token.
 * Whether a lead came from Facebook or Instagram is decided from the fetched lead, not from this webhook.
 */

const RATE = { limit: 300, windowSeconds: 60 };

export async function GET(request: Request) {
  const config = await getLeadIntakeConfig();
  if (intakeBlocked(config)) return NextResponse.json({ error: "Lead intake is not enabled" }, { status: 404 });
  const url = new URL(request.url);
  if (url.searchParams.get("hub.mode") === "subscribe" && safeEqual(url.searchParams.get("hub.verify_token"), config.metaVerifyToken)) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

export async function POST(request: Request) {
  const limited = await rateLimit("lead:meta", clientIp(request), RATE);
  if (!limited.allowed) return tooManyRequests(limited);

  const config = await getLeadIntakeConfig();
  if (intakeBlocked(config)) return NextResponse.json({ error: "Lead intake is not enabled" }, { status: 404 });

  const body = await readCappedBody(request);
  if (!body.ok) return body.response;
  // Authenticate before parsing; fails closed when no app secret is configured.
  if (!verifyHmacSha256(config.metaAppSecret, body.raw, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = parseJsonBody(body.raw) as { entry?: { changes?: { field?: string; value?: LeadgenChange }[] }[] } | undefined;
  if (!payload) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  let failed = 0;
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen" || !change.value?.leadgen_id) continue;
      const outcome = await handleLeadgenChange({ ...change.value, leadgen_id: String(change.value.leadgen_id) }, config.metaPageToken);
      // A parked lead is kept in the ledger and retried by the cron sweep, so Meta does not need to resend it.
      if (outcome.status === "error") failed += 1;
    }
  }
  return NextResponse.json({ ok: true, parkedForRetry: failed });
}

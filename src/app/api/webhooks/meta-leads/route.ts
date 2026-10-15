import { NextResponse } from "next/server";

import { clientIp, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { safeEqual, verifyHmacSha256 } from "@/lib/security/webhook-auth";
import { getLeadIntakeConfig, intakeBlocked, metaLeadAdsEnabled, metaWebhookSecrets, type LeadIntakeConfig } from "@/lib/leads/config";
import { parseJsonBody, readCappedBody } from "@/lib/leads/http";
import { handleLeadgenChange, NO_CONSENT_REASON, type LeadgenChange } from "@/lib/leads/meta";
import { jobSpec } from "@/lib/system/job-registry";
import { withRunRecord } from "@/lib/system/with-run-record";

/**
 * Meta Lead Ads (Facebook and Instagram) webhook — subscribe your Page to the `leadgen` field.
 *  GET  — Meta's verification handshake (hub.verify_token must match the verify token).
 *  POST — signed with X-Hub-Signature-256 (HMAC-SHA256 of the raw body using the app secret); carries only lead ids,
 *         so each lead is fetched from the Graph API with the page access token, then passes the consent gate (leads/meta.ts).
 * Whether a lead came from Facebook or Instagram is decided from the fetched lead, not from this webhook.
 * Off unless META_LEAD_ADS_ENABLED is "1"; refuses to run (404) without both the app secret and the verify token.
 * Secrets are never logged, and never echoed in a response.
 */

const RATE = { limit: 300, windowSeconds: 60 };

/** The route runs only when the flag is on, intake is live (production), and both secrets are set. Otherwise it is not there. */
async function gate(): Promise<{ config: LeadIntakeConfig; appSecret: string; verifyToken: string } | NextResponse> {
  if (!metaLeadAdsEnabled()) return NextResponse.json({ error: "Meta Lead Ads is not enabled" }, { status: 404 });
  const config = await getLeadIntakeConfig();
  if (intakeBlocked(config)) return NextResponse.json({ error: "Lead intake is not enabled" }, { status: 404 });
  const secrets = metaWebhookSecrets(config);
  if (!secrets.appSecret || !secrets.verifyToken) return NextResponse.json({ error: "Meta Lead Ads is not configured" }, { status: 404 });
  return { config, appSecret: secrets.appSecret, verifyToken: secrets.verifyToken };
}

export async function GET(request: Request) {
  const ready = await gate();
  if (ready instanceof NextResponse) return ready;
  const url = new URL(request.url);
  if (url.searchParams.get("hub.mode") === "subscribe" && safeEqual(url.searchParams.get("hub.verify_token"), ready.verifyToken)) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

async function handlePost(request: Request) {
  const limited = await rateLimit("lead:meta", clientIp(request), RATE);
  if (!limited.allowed) return tooManyRequests(limited);

  const ready = await gate();
  if (ready instanceof NextResponse) return ready;

  const body = await readCappedBody(request);
  if (!body.ok) return body.response;
  // Authenticate before parsing; fails closed when no app secret is configured.
  if (!verifyHmacSha256(ready.appSecret, body.raw, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = parseJsonBody(body.raw) as { entry?: { changes?: { field?: string; value?: LeadgenChange }[] }[] } | undefined;
  if (!payload) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  // Counts only: how many events were parked for retry, and how many were dropped because the form had no consent answered yes.
  let parked = 0;
  let droppedNoConsent = 0;
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen" || !change.value?.leadgen_id) continue;
      const outcome = await handleLeadgenChange({ ...change.value, leadgen_id: String(change.value.leadgen_id) }, ready.config.metaPageToken);
      // A parked lead is kept in the ledger and retried by the cron sweep, so Meta does not need to resend it.
      if (outcome.status === "error") parked += 1;
      if (outcome.status === "rejected" && outcome.reason === NO_CONSENT_REASON) droppedNoConsent += 1;
    }
  }
  return NextResponse.json({ ok: true, parkedForRetry: parked, droppedNoConsent });
}

// Control plane: records each run (status, duration, error class only) after the response is decided; the handler is unchanged.
export const POST = withRunRecord(jobSpec("webhook:meta-leads")!, handlePost);

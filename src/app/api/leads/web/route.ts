import { NextResponse } from "next/server";

import { clientIp, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { safeEqual } from "@/lib/security/webhook-auth";
import { getLeadIntakeConfig, intakeBlocked } from "@/lib/leads/config";
import { hashKey, parseJsonBody, readCappedBody } from "@/lib/leads/http";
import { ingestLead, normalizeLeadPhone } from "@/lib/leads/ingest";
import { mapFormFields, webFormLabel } from "@/lib/leads/sources";

/**
 * Website, blog, landing-page and contact-form leads.
 *
 * Two ways in, both fail-closed:
 *  - server-to-server: header `x-lead-secret` matching the configured web secret (use this from your own backend,
 *    Zapier/Make, a form service) — no Origin needed;
 *  - browser: a public `formKey` (in the body or `x-form-key`) matching the configured key AND an Origin on the
 *    allow-list. The key is an identifier, not a secret, so rate limiting + the honeypot do the abuse control.
 */

const RATE = { limit: 30, windowSeconds: 60 };
const RESERVED_KEYS = new Set(["formkey", "hp", "form", "message", "consent", "consent_text", "submission_id", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid", "page_url", "referrer", "campaign", "customer_category"]);
const ATTRIBUTION_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid", "page_url", "referrer", "campaign", "form"];

function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  if (!origin || !allowed.includes(origin.replace(/\/$/, ""))) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "content-type, x-form-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

export async function OPTIONS(request: Request) {
  const config = await getLeadIntakeConfig();
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get("origin"), config.allowedOrigins) });
}

export async function POST(request: Request) {
  const limited = await rateLimit("lead:web", clientIp(request), RATE);
  if (!limited.allowed) return tooManyRequests(limited);

  const config = await getLeadIntakeConfig();
  if (intakeBlocked(config)) return NextResponse.json({ error: "Lead intake is not enabled" }, { status: 404 });

  const origin = request.headers.get("origin");
  const cors = corsHeaders(origin, config.allowedOrigins);

  const body = await readCappedBody(request);
  if (!body.ok) return body.response;
  const parsed = parseJsonBody(body.raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: cors });
  const data = parsed as Record<string, unknown>;

  const bySecret = safeEqual(request.headers.get("x-lead-secret"), config.webSecret);
  const formKey = (typeof data.formKey === "string" ? data.formKey : request.headers.get("x-form-key")) ?? undefined;
  const byBrowser = !!config.webFormKey && safeEqual(formKey, config.webFormKey) && Object.keys(cors).length > 0;
  if (!bySecret && !byBrowser) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: cors });

  // Honeypot: a hidden field real visitors never fill. Acknowledge so bots learn nothing, store nothing.
  if (typeof data.hp === "string" && data.hp.trim()) return NextResponse.json({ ok: true }, { headers: cors });

  const text = (key: string) => (typeof data[key] === "string" ? (data[key] as string) : undefined);
  // Only genuine form answers are mapped/kept as notes — never the credential, honeypot, tracking or consent plumbing.
  const mapped = mapFormFields(
    Object.fromEntries(Object.entries(data).filter(([key, value]) => typeof value === "string" && !RESERVED_KEYS.has(key.toLowerCase())) as [string, string][]),
  );
  const name = text("name") ?? mapped.name;
  const phone = text("phone") ?? mapped.phone;
  const email = text("email") ?? mapped.email;
  const form = text("form");
  const leadSource = webFormLabel(form);

  // No submission id from the form? Collapse identical re-submits within 10 minutes (double clicks, retries).
  const bucket = Math.floor(Date.now() / (10 * 60 * 1000));
  const externalId = text("submission_id") ?? hashKey(form, normalizeLeadPhone(phone), email?.toLowerCase(), String(bucket));

  const attribution: Record<string, string | undefined> = {};
  for (const key of ATTRIBUTION_KEYS) attribution[key] = text(key);
  if (!attribution.page_url && origin) attribution.page_url = origin;

  const consentGiven = data.consent === true || data.consent === "true" || data.consent === "on";
  const outcome = await ingestLead(
    {
      source: "web",
      externalId,
      leadSource,
      name,
      phone,
      email,
      city: text("city") ?? mapped.city,
      productInterest: text("product_interest") ?? mapped.productInterest,
      customerCategory: text("customer_category"),
      message: text("message"),
      answers: mapped.answers,
      attribution,
      consent: consentGiven ? { at: new Date().toISOString(), text: text("consent_text") } : undefined,
    },
    // Never store the secret/form key a client sent along with the payload.
    { ...data, formKey: undefined },
  );

  if (outcome.status === "rejected") return NextResponse.json({ ok: false, error: outcome.reason }, { status: 422, headers: cors });
  // 5xx makes a server-side sender retry; the ledger row is already kept for replay either way.
  if (outcome.status === "error") return NextResponse.json({ ok: false, error: "Could not save the lead right now" }, { status: 503, headers: cors });
  return NextResponse.json({ ok: true }, { headers: cors });
}

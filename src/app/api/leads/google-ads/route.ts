import { NextResponse } from "next/server";

import { clientIp, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { safeEqual } from "@/lib/security/webhook-auth";
import { getLeadIntakeConfig, intakeBlocked } from "@/lib/leads/config";
import { parseJsonBody, readCappedBody } from "@/lib/leads/http";
import { ingestLead } from "@/lib/leads/ingest";
import { SOURCE_LABEL, mapFormFields } from "@/lib/leads/sources";

/**
 * Google Ads lead-form webhook (Search, YouTube, Performance Max, Discovery lead forms).
 * Google posts JSON with a `google_key` you set when configuring the webhook; there is no payload signature, so that
 * key is the credential (compared in constant time). `is_test` leads from the "Send test data" button are acknowledged
 * but never stored. Google retries on non-2xx, so answer 2xx only once the ledger row exists.
 */

type GoogleColumn = { column_id?: string; column_name?: string; string_value?: string };
type GooglePayload = {
  lead_id?: string;
  google_key?: string;
  is_test?: boolean;
  form_id?: string | number;
  campaign_id?: string | number;
  adgroup_id?: string | number;
  creative_id?: string | number;
  gcl_id?: string;
  user_column_data?: GoogleColumn[];
};

const RATE = { limit: 120, windowSeconds: 60 };

export async function POST(request: Request) {
  const limited = await rateLimit("lead:google", clientIp(request), RATE);
  if (!limited.allowed) return tooManyRequests(limited);

  const config = await getLeadIntakeConfig();
  if (intakeBlocked(config)) return NextResponse.json({ error: "Lead intake is not enabled" }, { status: 404 });

  const body = await readCappedBody(request);
  if (!body.ok) return body.response;
  const payload = parseJsonBody(body.raw) as GooglePayload | undefined;
  if (!payload || typeof payload !== "object") return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  // Fails closed when no key is configured.
  if (!safeEqual(payload.google_key, config.googleKey)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (payload.is_test) return NextResponse.json({ ok: true, test: true });
  if (!payload.lead_id) return NextResponse.json({ error: "lead_id is required" }, { status: 400 });

  const fields: Record<string, string> = {};
  for (const column of payload.user_column_data ?? []) {
    const key = column.column_id || column.column_name;
    if (key && column.string_value) fields[key] = column.string_value;
  }
  const mapped = mapFormFields(fields);

  const { google_key: _omitKey, ...safeRaw } = payload;
  void _omitKey;
  const outcome = await ingestLead(
    {
      source: "google_ads",
      externalId: String(payload.lead_id),
      leadSource: SOURCE_LABEL.google,
      name: mapped.name,
      phone: mapped.phone,
      email: mapped.email,
      city: mapped.city,
      productInterest: mapped.productInterest,
      answers: mapped.answers,
      attribution: {
        campaign: payload.campaign_id !== undefined ? String(payload.campaign_id) : undefined,
        adgroup: payload.adgroup_id !== undefined ? String(payload.adgroup_id) : undefined,
        creative: payload.creative_id !== undefined ? String(payload.creative_id) : undefined,
        form: payload.form_id !== undefined ? String(payload.form_id) : undefined,
        gclid: payload.gcl_id,
        platform: "google",
      },
    },
    safeRaw,
  );

  if (outcome.status === "error") return NextResponse.json({ ok: false }, { status: 503 });
  // A lead with no usable contact is stored as REJECTED; acknowledge so Google doesn't retry it forever.
  return NextResponse.json({ ok: true, status: outcome.status });
}

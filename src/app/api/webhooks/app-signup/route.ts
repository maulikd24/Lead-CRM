import { NextResponse } from "next/server";

import { clientIp, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { verifyHmacSha256 } from "@/lib/security/webhook-auth";
import { parseJsonBody, readCappedBody } from "@/lib/leads/http";
import { ingestLead } from "@/lib/leads/ingest";
import { mapAppSignup } from "@/lib/signup/map-app-signup";
import { statusForMapperFailure, statusForOutcome } from "@/lib/signup/outcome-status";

/**
 * Real-time signup feed from the Allvest app. Signed with X-Signature: hex HMAC-SHA256 of the raw body using
 * APP_SIGNUP_SECRET (an optional "sha256=" prefix is accepted). Returns 404 while APP_SIGNUP_SECRET is unset.
 */
export async function POST(request: Request) {
  const limited = await rateLimit("signup:app", clientIp(request), { limit: 300, windowSeconds: 60 });
  if (!limited.allowed) return tooManyRequests(limited);

  const secret = process.env.APP_SIGNUP_SECRET;
  if (!secret) return NextResponse.json({ error: "Signup feed is not enabled" }, { status: 404 });

  const body = await readCappedBody(request);
  if (!body.ok) return body.response;
  // Authenticate before parsing.
  if (!verifyHmacSha256(secret, body.raw, request.headers.get("x-signature"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = parseJsonBody(body.raw);
  if (payload === undefined) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const mapped = mapAppSignup(payload);
  if (!mapped.ok) {
    const { http, body: failBody } = statusForMapperFailure(mapped.reason);
    return NextResponse.json(failBody, { status: http });
  }

  // Persist only the validated contract fields (not the request body) as the ledger's raw payload: data minimisation.
  const outcome = await ingestLead(mapped.lead, mapped.contract);
  const { http, body: resBody } = statusForOutcome(outcome);
  return NextResponse.json(resBody, { status: http });
}

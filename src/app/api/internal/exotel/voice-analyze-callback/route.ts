import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { getAdapter, isMockAdapter } from "@/lib/integrations/registry";
import { isProductionRuntime } from "@/lib/security/webhook-auth";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { runReview } from "@/lib/ai/run-review";

/**
 * Receives Exotel's async ExoVoiceAnalyze result (triggered from
 * src/lib/integrations/adapters/exotel.ts's triggerVoiceAnalysis, called right after a
 * call_completed webhook in src/app/api/webhooks/[provider]/route.ts).
 *
 * UNVERIFIED: Exotel's ExoVoiceAnalyze callback JSON schema is not published in what could be
 * fetched from Exotel's docs (developer.exotel.com/docs/gen-ai/api-reference/exovoice-analyze
 * describes the triggering request but not the callback payload). Parsing below tries several
 * plausible field-name variants and logs the raw payload so the real shape can be confirmed
 * against Exotel's sandbox/support before go-live — this must be verified at implementation time.
 */
export async function POST(request: Request) {
  const limited = await rateLimit("webhook:exotel-voice", clientIp(request), { limit: 300, windowSeconds: 60 });
  if (!limited.allowed) return tooManyRequests(limited);

  const url = new URL(request.url);
  const activityId = url.searchParams.get("activityId");
  if (!activityId) {
    return NextResponse.json({ error: "Missing activityId" }, { status: 400 });
  }

  // Same verification as the generic webhook route: live Exotel checks the ?secret= (fails closed when unset);
  // the mock adapter checks nothing, so it is refused in Production.
  const adapter = await getAdapter("exotel");
  if (isMockAdapter(adapter) && isProductionRuntime()) {
    return NextResponse.json({ error: "Integration not enabled: exotel" }, { status: 404 });
  }
  const rawBody = await request.text();
  const contentType = request.headers.get("content-type") ?? "";
  const headers = Object.fromEntries(request.headers.entries());
  headers["x-webhook-query"] = url.search.replace(/^\?/, "");

  if (!adapter.verifySignature(headers, rawBody)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const review = await prisma.conversationReview.findUnique({ where: { sourceActivityId: activityId } });
  if (!review) {
    return NextResponse.json({ error: "No ConversationReview for this activityId" }, { status: 404 });
  }
  // Idempotent: a retried callback must not re-run the (paid) AI review. A late callback after the stale-check
  // marked it FAILED is still accepted.
  if (review.status !== "PENDING_TRANSCRIPT" && review.status !== "FAILED") {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  let body: Record<string, unknown>;
  try {
    body = contentType.includes("application/json") ? JSON.parse(rawBody || "{}") : Object.fromEntries(new URLSearchParams(rawBody));
  } catch {
    body = {};
  }

  // Defensive multi-field parsing — see the UNVERIFIED note above.
  const transcript =
    typeof body.transcript === "string"
      ? body.transcript
      : typeof body.transcription === "string"
        ? body.transcription
        : typeof (body.result as Record<string, unknown> | undefined)?.transcript === "string"
          ? ((body.result as Record<string, unknown>).transcript as string)
          : typeof (body.insights as Record<string, unknown> | undefined)?.transcript === "object"
            ? (((body.insights as Record<string, unknown>).transcript as Record<string, unknown>)?.text as string | undefined)
            : typeof (body.data as Record<string, unknown> | undefined)?.transcript === "string"
              ? ((body.data as Record<string, unknown>).transcript as string)
              : undefined;

  if (!transcript) {
    console.error("ExoVoiceAnalyze callback: could not find a transcript field in payload", JSON.stringify(body));
    await prisma.conversationReview.update({
      where: { id: review.id },
      data: { status: "FAILED", failureReason: "Could not parse a transcript from Exotel's callback payload — see server logs for the raw payload" },
    });
    return NextResponse.json({ ok: true });
  }

  // Atomic claim: of two concurrent deliveries, only the one that flips the status runs the review.
  const claimed = await prisma.conversationReview.updateMany({
    where: { id: review.id, status: { in: ["PENDING_TRANSCRIPT", "FAILED"] } },
    data: { transcript, status: "ANALYZING" },
  });
  if (claimed.count === 0) return NextResponse.json({ ok: true, duplicate: true });
  await runReview(review.id);

  return NextResponse.json({ ok: true });
}

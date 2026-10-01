import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { getAdapter } from "@/lib/integrations/registry";
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
  const url = new URL(request.url);
  const activityId = url.searchParams.get("activityId");
  if (!activityId) {
    return NextResponse.json({ error: "Missing activityId" }, { status: 400 });
  }

  // Same mock/live-aware verification the generic webhook route already uses — in mock mode
  // exotelMockAdapter defines no verifySignature, so this is a no-op; in live mode it checks the
  // shared secret exactly like exotelAdapter.verifySignature already does for inbound call events.
  const adapter = await getAdapter("exotel");
  const rawBody = await request.text();
  const contentType = request.headers.get("content-type") ?? "";
  const headers = Object.fromEntries(request.headers.entries());
  headers["x-webhook-query"] = url.search.replace(/^\?/, "");

  if (adapter.verifySignature && !adapter.verifySignature(headers, rawBody)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const review = await prisma.conversationReview.findUnique({ where: { sourceActivityId: activityId } });
  if (!review) {
    return NextResponse.json({ error: "No ConversationReview for this activityId" }, { status: 404 });
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

  await prisma.conversationReview.update({ where: { id: review.id }, data: { transcript, status: "ANALYZING" } });
  await runReview(review.id);

  return NextResponse.json({ ok: true });
}

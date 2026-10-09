import { NextResponse } from "next/server";

import { clientIp, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { parseJsonBody, readCappedBody } from "@/lib/leads/http";
import { portfolioFeedSecret } from "@/lib/portfolio-feed/flag";
import { verifyFeedSignature } from "@/lib/portfolio-feed/signature";
import { httpStatusFor, ingestPortfolioBatch } from "@/lib/portfolio-feed/ingest";
import { LIMITS, parseEnvelope } from "@/lib/portfolio-feed/mapper";
import { auditBatch, lookupCustomers, prismaFeedRepo } from "@/lib/portfolio-feed/prisma-repo";

/**
 * Portfolio feed (push model): the back office posts holdings snapshots and transactions for existing customers.
 * Contract: docs/integrations/portfolio-feed.md. Signed with x-signature: hex HMAC-SHA256 of `${x-timestamp}.${rawBody}`
 * using PORTFOLIO_FEED_SECRET ("sha256=" prefix accepted); x-timestamp must be within 5 minutes. 404 while PORTFOLIO_FEED_ENABLED is off or the secret is unset.
 */
export async function POST(request: Request) {
  const limited = await rateLimit("portfolio-feed", clientIp(request), { limit: 120, windowSeconds: 60 });
  if (!limited.allowed) return tooManyRequests(limited);

  const secret = portfolioFeedSecret();
  if (!secret) return NextResponse.json({ error: "Portfolio feed is not enabled" }, { status: 404 });

  const body = await readCappedBody(request, LIMITS.bodyBytes);
  if (!body.ok) return body.response;
  // Authenticate before parsing.
  const auth = verifyFeedSignature({ secret, timestamp: request.headers.get("x-timestamp"), signature: request.headers.get("x-signature"), rawBody: body.raw });
  if (auth === "invalid") return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  if (auth === "stale") return NextResponse.json({ error: "Timestamp outside the allowed window" }, { status: 401 });

  const payload = parseJsonBody(body.raw);
  if (payload === undefined) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const envelope = parseEnvelope(payload);
  if (!envelope.ok) return NextResponse.json({ error: "Invalid payload", issues: envelope.issues }, { status: 422 });

  try {
    const summary = await ingestPortfolioBatch(envelope.envelope, { lookup: lookupCustomers, repo: prismaFeedRepo, audit: auditBatch });
    return NextResponse.json(summary, { status: httpStatusFor(summary) });
  } catch (error) {
    console.error("Portfolio feed: batch failed", error instanceof Error ? error.name : "unknown");
    // Generic on purpose: the sender retries the whole batch, which is safe (every write is idempotent).
    return NextResponse.json({ error: "Could not process batch" }, { status: 500 });
  }
}

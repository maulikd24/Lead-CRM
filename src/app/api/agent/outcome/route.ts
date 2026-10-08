import { NextResponse } from "next/server";
import { z } from "zod";

import { clientIp, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { authenticateAgent } from "@/lib/intelligence/agent";
import { ASSET_CLASSES, OUTCOME_CHANNELS } from "@/lib/intelligence/constants";
import { recordInteractionOutcome } from "@/lib/intelligence/outcomes";

const schema = z.object({
  clientId: z.string().min(1),
  outcome: z.enum(["interested", "not_interested", "follow_up", "converted", "not_relevant", "rm_handover", "service_issue"]),
  channel: z.enum(OUTCOME_CHANNELS).default("AI_BOT"),
  assetClass: z.enum(ASSET_CLASSES).optional(),
  programme: z.string().max(80).optional(),
  note: z.string().max(1000).optional(),
  summary: z.string().max(1500).optional(),
  followUpAt: z.string().datetime().optional(),
});

/**
 * An AI agent reports how a conversation ended. The same structured outcome an RM logs: it updates acceptance, the
 * next best action and the priority lists straight away; a handover creates a task and alerts the customer's RM.
 */
export async function POST(request: Request) {
  const limited = await rateLimit("agent:outcome", clientIp(request), { limit: 120, windowSeconds: 60 });
  if (!limited.allowed) return tooManyRequests(limited);
  if (!authenticateAgent(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = await request.text();
  if (raw.length > 20_000) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  const data = parsed.data;

  if (data.outcome === "rm_handover" && !data.summary?.trim()) return NextResponse.json({ error: "A handover needs a summary for the RM" }, { status: 422 });
  if (data.outcome === "service_issue" && !data.note?.trim()) return NextResponse.json({ error: "Describe the service issue in note" }, { status: 422 });

  try {
    const row = await recordInteractionOutcome({
      clientId: data.clientId,
      outcome: data.outcome.toUpperCase() as "INTERESTED",
      channel: data.channel,
      actorType: "AI_AGENT",
      assetClass: data.assetClass,
      programme: data.programme,
      note: data.note,
      summary: data.summary,
      followUpAt: data.followUpAt ? new Date(data.followUpAt) : null,
    });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (error) {
    if (error instanceof Error && error.message === "Client not found") return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    console.error("Agent outcome failed", error);
    return NextResponse.json({ error: "Could not record the outcome" }, { status: 500 });
  }
}

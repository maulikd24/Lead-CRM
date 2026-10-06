import { NextResponse } from "next/server";

import { clientIp, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { authenticateAgent, buildAgentBriefing } from "@/lib/intelligence/agent";

// For AI agents (WhatsApp / calling / KYC / funding bots): the full briefing to read before contacting a customer.
export async function GET(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const limited = await rateLimit("agent:briefing", clientIp(request), { limit: 120, windowSeconds: 60 });
  if (!limited.allowed) return tooManyRequests(limited);
  if (!authenticateAgent(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { clientId } = await params;
  const includeContact = new URL(request.url).searchParams.get("include_contact") === "1";
  const briefing = await buildAgentBriefing(clientId, { includeContact });
  if (!briefing) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  return NextResponse.json(briefing);
}

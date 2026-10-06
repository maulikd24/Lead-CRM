import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { authenticateAgent } from "@/lib/intelligence/agent";

// Customers whose next best action is owned by "AI Bot" (only assigned once AI_AGENTS_ENABLED=1), most urgent first.
export async function GET(request: Request) {
  const limited = await rateLimit("agent:work", clientIp(request), { limit: 60, windowSeconds: 60 });
  if (!limited.allowed) return tooManyRequests(limited);
  if (!authenticateAgent(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = Math.min(50, Number(new URL(request.url).searchParams.get("limit")) || 20);
  const rows = await prisma.customerIntelligence.findMany({
    where: { nbaOwner: "AI Bot", nbaTiming: { in: ["Today", "This Week"] }, client: { isDeleted: false, mergedIntoId: null, status: { in: ["ACTIVE", "COMPLETED"] } } },
    orderBy: { priorityScore: "desc" },
    take: limit,
    select: { clientId: true, nbaProgramme: true, nbaAction: true, nbaTopic: true, nbaPriority: true, nbaTiming: true },
  });
  return NextResponse.json({ customers: rows.map((r) => ({ clientId: r.clientId, programme: r.nbaProgramme, action: r.nbaAction, topic: r.nbaTopic, priority: r.nbaPriority, timing: r.nbaTiming })) });
}

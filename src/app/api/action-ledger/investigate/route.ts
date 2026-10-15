import { NextResponse } from "next/server";

import { apiGuard } from "@/lib/access/api-guard";
import { actionLedgerInvestigateEnabled } from "@/lib/ledger/flag";
import { cleanId, parseBefore, parseBy, parseKinds, parseLimit } from "@/lib/ledger/params";
import { getActionLedger } from "@/lib/ledger/read";
import type { LedgerSubject } from "@/lib/ledger/types";

export const dynamic = "force-dynamic";

/** GET /api/action-ledger/investigate?by=correlation|customer|run|approval&q=<id>: the audit and debugging tool. ADMIN only (404 for everyone else: the route does not reveal itself). */
export async function GET(request: Request) {
  const guard = await apiGuard("action-ledger-investigate", "view", 404);
  if (!guard.ok) return guard.response;
  if (!actionLedgerInvestigateEnabled()) return new NextResponse("Not found", { status: 404 });
  const q = new URL(request.url).searchParams;
  const id = cleanId(q.get("q"));
  if (!id) return NextResponse.json({ error: "q is required" }, { status: 400 });
  const by = parseBy(q.get("by"));
  const subject: LedgerSubject = by === "customer" ? { type: "client", id } : by === "run" ? { type: "agentRun", id } : by === "approval" ? { type: "approval", id } : { type: "correlation", id };
  const { user } = guard.session;
  const out = await getActionLedger(subject, { viewer: { id: user.id, role: user.role }, kinds: parseKinds(q.get("kind")), limit: parseLimit(q.get("limit")), before: parseBefore(q.get("before")) });
  if (!out.ok) return new NextResponse("Not found", { status: 404 });
  return NextResponse.json({ by, entries: out.entries, nextCursor: out.nextCursor, olderNotShown: out.olderNotShown, counts: out.counts, stats: out.stats }, { headers: { "cache-control": "no-store" } });
}

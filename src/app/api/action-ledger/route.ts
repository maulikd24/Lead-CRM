import { NextResponse } from "next/server";

import { apiGuard } from "@/lib/access/api-guard";
import { actionLedgerEnabled } from "@/lib/ledger/flag";
import { cleanId, parseBefore, parseKinds, parseLimit } from "@/lib/ledger/params";
import { getActionLedger } from "@/lib/ledger/read";

export const dynamic = "force-dynamic";

/**
 * GET /api/action-ledger?clientId=...&kind=message,task&limit=25&before=<iso>: why Allvest did each thing for ONE customer, for the signed-in person.
 * Same scope as the Customer 360 page: an RM their own customers, a manager their team, an admin all; any other customer answers 404 exactly like a missing one.
 * Read only. Ids, enums, times and staff names: never a message or draft body.
 */
export async function GET(request: Request) {
  const guard = await apiGuard("action-ledger", "view");
  if (!guard.ok) return guard.response;
  if (!actionLedgerEnabled()) return new NextResponse("Not found", { status: 404 });
  const q = new URL(request.url).searchParams;
  const clientId = cleanId(q.get("clientId"));
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  const { user } = guard.session;
  const out = await getActionLedger({ type: "client", id: clientId }, { viewer: { id: user.id, role: user.role }, kinds: parseKinds(q.get("kind")), limit: parseLimit(q.get("limit")), before: parseBefore(q.get("before")) });
  if (!out.ok) return out.reason === "forbidden" ? NextResponse.json({ error: "Forbidden" }, { status: 403 }) : new NextResponse("Not found", { status: 404 });
  return NextResponse.json({ entries: out.entries, nextCursor: out.nextCursor, olderNotShown: out.olderNotShown, counts: out.counts, hidden: out.hidden }, { headers: { "cache-control": "no-store" } });
}

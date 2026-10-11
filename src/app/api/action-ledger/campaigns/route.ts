import { NextResponse } from "next/server";

import { apiGuard } from "@/lib/access/api-guard";
import { actionLedgerEnabled } from "@/lib/ledger/flag";
import { cleanId, parseBefore, parseKinds, parseLimit } from "@/lib/ledger/params";
import { getActionLedger } from "@/lib/ledger/read";

export const dynamic = "force-dynamic";

/**
 * GET /api/action-ledger/campaigns?campaignId=...: campaign-level actions for MARKETING (and admin): ad autopilot chains and aggregated counts. A customer is
 * only ever a keyed pseudonym; no customer record is opened and no customer is named.
 */
export async function GET(request: Request) {
  const guard = await apiGuard("action-ledger-campaigns", "view");
  if (!guard.ok) return guard.response;
  if (!actionLedgerEnabled()) return new NextResponse("Not found", { status: 404 });
  const q = new URL(request.url).searchParams;
  const { user } = guard.session;
  const out = await getActionLedger({ type: "campaign", id: cleanId(q.get("campaignId")) }, { viewer: { id: user.id, role: user.role }, kinds: parseKinds(q.get("kind")), limit: parseLimit(q.get("limit")), before: parseBefore(q.get("before")) });
  if (!out.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ entries: out.entries, nextCursor: out.nextCursor, olderNotShown: out.olderNotShown }, { headers: { "cache-control": "no-store" } });
}

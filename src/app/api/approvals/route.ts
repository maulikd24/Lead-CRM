import { NextResponse } from "next/server";

import { apiGuard } from "@/lib/access/api-guard";
import { isKind } from "@/lib/policy/approvals/canonical/definitions";
import { approvalsInboxEnabled } from "@/lib/policy/approvals/canonical/flag";
import { approvalService } from "@/lib/policy/approvals/canonical/wiring";

export const dynamic = "force-dynamic";

/**
 * GET /api/approvals?tab=awaiting|mine&kind=...: the unified list, for the signed-in person only. The same service and the same scoping
 * as the inbox page: an approver sees only the kinds they may approve, MARKETING only the marketing ones, an RM only their own customers' items.
 * Read-only: decisions go through the inbox action, which calls each legacy path.
 */
export async function GET(request: Request) {
  const guard = await apiGuard("approvals", "view");
  if (!guard.ok) return guard.response;
  if (!approvalsInboxEnabled()) return new NextResponse("Not found", { status: 404 });
  const q = new URL(request.url).searchParams;
  const kind = q.get("kind") ?? "";
  const { user } = guard.session;
  const out = await approvalService().listFor({ id: user.id, role: user.role, name: user.name ?? null }, { tab: q.get("tab") === "mine" ? "mine" : "awaiting", kind: isKind(kind) ? kind : undefined });
  return NextResponse.json({ items: out.items, counts: out.counts }, { headers: { "cache-control": "no-store" } });
}

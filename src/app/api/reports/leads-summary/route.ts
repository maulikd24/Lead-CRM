import Papa from "papaparse";

import type { Prisma } from "@/generated/prisma/client";
import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { getLeadsActivity, parseLeadsActivityParams } from "@/lib/reports/leads-activity";

export async function GET(request: Request) {
  // Reports itself is Admin/Manager-only (see reports/page.tsx) — tighter than the Clients CSV
  // export's requireUser(), since an RM shouldn't be able to pull this via a crafted URL either.
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);

  const url = new URL(request.url);
  const rmId = url.searchParams.get("rmId");

  const clientWhere: Prisma.ClientWhereInput =
    rmId && (!visibleUserIds || visibleUserIds.includes(rmId))
      ? { assignedToId: rmId }
      : visibleUserIds
        ? { assignedToId: { in: visibleUserIds } }
        : {};

  const { granularity, from, to } = parseLeadsActivityParams(url.searchParams, new Date());
  const buckets = await getLeadsActivity({ from, to, granularity, clientWhere });

  const rows = buckets.map((b) => ({
    period: b.label,
    periodStart: b.periodStart.toISOString().slice(0, 10),
    periodEnd: b.periodEnd.toISOString().slice(0, 10),
    created: b.created,
    updated: b.updated,
  }));

  const csv = Papa.unparse(rows);
  const filename = `leads-activity-${granularity}-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

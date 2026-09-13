import Papa from "papaparse";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { buildClientWhere, type ClientFilterParams } from "@/lib/clients/build-client-where";
import { computeSlaStatus, stageAgeHours } from "@/lib/stage-engine/sla-status";
import { effectiveStageEnteredAt } from "@/lib/stage-engine/held-duration";
import { formatDate, formatDateTime, formatStageAge } from "@/lib/utils/format";

// Safety valve against a runaway export — same access model as /clients (getVisibleUserIds
// scoping), just unbounded by pagination and capped here instead.
const EXPORT_ROW_CAP = 5000;

export async function GET(request: Request) {
  const session = await requireUser();
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);

  const url = new URL(request.url);
  const idsParam = url.searchParams.get("ids");
  const params: ClientFilterParams = Object.fromEntries(url.searchParams.entries());

  // "Export Selected" from the list page's bulk toolbar — export exactly these IDs instead of
  // the full filtered list, but keep the same RM-visibility scoping so a crafted URL can't
  // exfiltrate out-of-scope clients.
  const where: Prisma.ClientWhereInput = idsParam
    ? {
        id: { in: idsParam.split(",").filter(Boolean) },
        ...(visibleUserIds ? { assignedToId: { in: visibleUserIds } } : {}),
      }
    : buildClientWhere(params, visibleUserIds);

  const clients = await prisma.client.findMany({
    where,
    include: { assignedTo: true, currentStage: true },
    orderBy: { createdAt: "desc" },
    take: EXPORT_ROW_CAP,
  });

  const clientIds = clients.map((c) => c.id);
  const exceptions = clientIds.length
    ? await prisma.exception.findMany({
        where: { clientId: { in: clientIds } },
        select: { clientId: true, stageId: true, createdAt: true, resolvedAt: true },
      })
    : [];

  const now = new Date();
  const rows = clients.map((client) => {
    const heldMs = exceptions
      .filter((e) => e.clientId === client.id && e.stageId === client.currentStageId)
      .reduce((sum, e) => sum + Math.max(0, (e.resolvedAt ?? now).getTime() - e.createdAt.getTime()), 0);
    const effectiveEnteredAt = effectiveStageEnteredAt(client.stageEnteredAt, heldMs);
    const slaStatus = computeSlaStatus(effectiveEnteredAt, client.currentStage.slaHours, now);

    return {
      clientCode: client.clientCode,
      name: client.name,
      mobile: client.mobile,
      email: client.email ?? "",
      pan: client.pan ?? "",
      region: client.region ?? "",
      stage: client.currentStage.name,
      stageAge: formatStageAge(stageAgeHours(effectiveEnteredAt, now)),
      priority: client.priority,
      slaStatus,
      status: client.status,
      assignedRm: client.assignedTo?.name ?? "Unassigned",
      createdAt: formatDate(client.createdAt),
      lastUpdated: formatDateTime(client.updatedAt),
    };
  });

  const csv = Papa.unparse(rows);
  const truncated = clients.length >= EXPORT_ROW_CAP;
  const filename = `clients-export-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Total-Count": String(clients.length),
      "X-Truncated": String(truncated),
    },
  });
}

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { buildUserEventWhere } from "@/lib/activity/query";
import { logExport } from "@/lib/activity/log-user-event";
import { istDateKey } from "@/lib/utils/ist-date";

const EXPORT_ROW_CAP = 20000;

function csvCell(value: string | null | undefined): string {
  const text = value ?? "";
  // Neutralise spreadsheet formula injection from user-controlled text (emails, paths).
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  void logExport(session.user, "/api/activity-log/export", "Downloaded activity log CSV");

  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);
  const url = new URL(request.url);
  const where = buildUserEventWhere(
    {
      user: url.searchParams.get("user") ?? undefined,
      type: url.searchParams.get("type") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
    },
    visibleUserIds,
  );

  const events = await prisma.userEvent.findMany({
    where,
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: EXPORT_ROW_CAP,
  });

  const header = ["Time (UTC)", "User", "Email", "Role", "Event", "Entity", "Entity ID", "Page", "Details", "IP", "User agent"];
  const lines = events.map((e) =>
    [
      e.createdAt.toISOString(),
      e.user?.name,
      e.userEmail,
      e.userRole,
      e.type,
      e.entity,
      e.entityId,
      e.path,
      e.summary,
      e.ipAddress,
      e.userAgent,
    ]
      .map(csvCell)
      .join(","),
  );
  const csv = [header.map(csvCell).join(","), ...lines].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="activity-log-${istDateKey(new Date())}.csv"`,
    },
  });
}

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { logExport } from "@/lib/activity/log-user-event";
import { GO_LIVE_ITEMS } from "@/lib/go-live/items";
import { runAutoChecks } from "@/lib/go-live/checks";
import { istDateKey } from "@/lib/utils/ist-date";

function cell(value: string | null | undefined): string {
  const text = value ?? "";
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text; // spreadsheet formula injection
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET() {
  const session = await requireRole(["ADMIN"]);
  void logExport(session.user, "/api/go-live/export", "Downloaded go-live checklist CSV");

  const [auto, ticks] = await Promise.all([runAutoChecks(), prisma.goLiveCheck.findMany()]);
  const tickById = new Map(ticks.map((t) => [t.itemId, t]));

  const header = ["Area", "Priority", "Owner", "Item", "Type", "Status", "Details", "Result / note"];
  const lines = GO_LIVE_ITEMS.map((item) => {
    const result = auto[item.id];
    const tick = tickById.get(item.id);
    const status = item.kind === "auto" ? (result?.status === "pass" ? "Ready" : result?.status === "warn" ? "Check" : "Not ready") : tick?.done ? "Verified" : "Open";
    return [item.area, item.priority, item.owner, item.title, item.kind === "auto" ? "Automatic" : "Manual", status, item.detail, item.kind === "auto" ? (result?.message ?? "") : (tick?.note ?? "")].map(cell).join(",");
  });

  return new Response([header.map(cell).join(","), ...lines].join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="go-live-checklist-${istDateKey(new Date())}.csv"`,
    },
  });
}

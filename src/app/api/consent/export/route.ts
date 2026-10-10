import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { logExport } from "@/lib/activity/log-user-event";
import { consentCsv } from "@/lib/consent/csv";
import { istDateKey } from "@/lib/utils/ist-date";

const MAX_ROWS = 50_000;

/** The whole ledger, newest first, with the customer code only: no names, contact details, reasons or actor ids. Admin only, and only while NEXT_PUBLIC_CONSENT=1. */
export async function GET() {
  const session = await requireRole(["ADMIN"]);
  if (process.env.NEXT_PUBLIC_CONSENT !== "1") return new Response("Not found", { status: 404 });
  void logExport(session.user, "/api/consent/export", "Downloaded consent ledger CSV");

  const rows = await prisma.consentRecord.findMany({
    orderBy: { capturedAt: "desc" },
    take: MAX_ROWS,
    select: { purpose: true, channel: true, status: true, source: true, noticeVersion: true, capturedAt: true, expiresAt: true, client: { select: { clientCode: true } } },
  });
  const body = consentCsv(rows.map(({ client, ...r }) => ({ clientCode: client.clientCode, ...r })));

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="consent-ledger-${istDateKey(new Date())}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

import { notFound } from "next/navigation";

import { ReportDocument } from "@/components/creative/report-document";
import { requireRole } from "@/lib/auth/require-role";
import { canAccessMarketing } from "@/lib/access/marketing-access";
import { prisma } from "@/lib/db/prisma";
import { directorReportsEnabled } from "@/lib/creative/flags";
import { loadDirectorReport } from "@/lib/director/db";
import { previousWeeks } from "@/lib/director/digest";
import { addDays, todayInTimeZone } from "@/lib/marketing/dates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Marketing performance report", robots: { index: false, follow: false } };

const REAL = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v ? v : null);

/**
 * The print-friendly director report: every figure, no app chrome, built to print on A4 or be saved as a PDF. It lives outside
 * the dashboard layout on purpose (that layout pins the page to the screen height, which would clip a print). Same gate as the
 * Reports tab (ADMIN or MARKETING, flag on); opening it is an export and is audited.
 */
export default async function ReportPrintPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireRole(["ADMIN", "MARKETING"]);
  if (!canAccessMarketing(session.user.role) || !directorReportsEnabled()) notFound();
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const now = new Date();
  const today = todayInTimeZone(now, "Asia/Kolkata");
  let from = REAL(one(q.from));
  let to = REAL(one(q.to));
  if (!from || !to || from > to || to > today || (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1 > 90) {
    const w = previousWeeks(now).current;
    from = w.from;
    to = w.to;
  }
  const report = await loadDirectorReport(from, to, now);
  await prisma.auditLog.create({ data: { userId: session.user.id, entity: "DirectorReport", entityId: `${from}_${to}`, action: "report_printed" } });
  void addDays;
  return <ReportDocument report={report} />;
}

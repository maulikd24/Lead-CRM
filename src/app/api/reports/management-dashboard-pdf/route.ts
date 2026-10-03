import PDFDocument from "pdfkit";

import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { getReportsPageData } from "@/lib/reports/get-reports-page-data";
import { getTeamActivityRows } from "@/lib/reports/team-performance";
import { getLeadsActivity } from "@/lib/reports/leads-activity";
import { parseManagementPeriodParams, granularityForPeriod } from "@/lib/reports/period-range";
import { formatIstDate } from "@/lib/utils/ist-date";
import type { Prisma } from "@/generated/prisma/client";
import { logExport } from "@/lib/activity/log-user-event";

export async function GET(request: Request) {
  // Same gate as the Manager Dashboard page itself — Admin/Manager only, scoped to the caller's
  // visible clients exactly like the page, so the PDF can never show more than the page would.
  const session = await requireRole(["ADMIN", "MANAGER"]);
  void logExport(session.user, "/api/reports/management-dashboard-pdf", "Downloaded Manager Dashboard PDF");
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);
  const clientFilter: Prisma.ClientWhereInput = visibleUserIds
    ? { assignedToId: { in: visibleUserIds }, isDeleted: false }
    : { isDeleted: false };
  const now = new Date();

  const url = new URL(request.url);
  // Same shared period helper the page uses (?period=/?anchor=) — the PDF boundary dates can never
  // drift from what's on screen.
  const { granularity, from, to } = parseManagementPeriodParams(url.searchParams, now);

  // Same calls the page itself makes — the PDF can't drift from what's on screen.
  const {
    totalLeads,
    activeClients,
    completedClients,
    onHoldClients,
    slaCompliance,
    avgOnboardingDays,
    funnelData,
    conversionData,
    stageDurations,
    rmPerformance,
  } = await getReportsPageData(clientFilter, visibleUserIds, now, { from, to });
  const conversionByStageId = new Map(conversionData.map((c) => [c.stageId, c]));
  const stageDurationByStageId = new Map(stageDurations.map((d) => [d.stageId, d]));
  const activityByRm = await getTeamActivityRows(
    rmPerformance.map((row) => row.rm.id),
    { from, to },
  );
  const leadsActivityBuckets = await getLeadsActivity({
    from,
    to,
    granularity: granularityForPeriod(granularity),
    clientWhere: clientFilter,
  });

  const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
    // Landscape: Team Performance alone has 12 columns, which doesn't fit legibly in this helper's
    // fixed-column-width approach at A4 portrait's ~495pt usable width — landscape gives ~792pt.
    const doc = new PDFDocument({ margin: 40, size: "A4", layout: "landscape" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const marginLeft = doc.page.margins.left;

    function heading(title: string) {
      doc.x = marginLeft;
      doc.moveDown(0.75);
      doc.fontSize(14).text(title, marginLeft, doc.y, { underline: true });
      doc.fontSize(9);
    }

    function table(headers: string[], rows: (string | number)[][], colWidths: number[]) {
      // Explicit page margin, not doc.x — doc.x carries over from the last EXPLICITLY-positioned
      // text call (each header/cell below passes its own x), so relying on it here compounds an
      // ever-growing rightward drift across sections instead of each table starting at the margin.
      const startX = marginLeft;
      let y = doc.y + 4;
      doc.fontSize(8).font("Helvetica-Bold");
      headers.forEach((h, i) => {
        const x = startX + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
        doc.text(h, x, y, { width: colWidths[i] });
      });
      y += 14;
      doc.font("Helvetica").fontSize(8);
      for (const row of rows) {
        if (y > 500) {
          doc.addPage();
          y = 40;
        }
        row.forEach((cell, i) => {
          const x = startX + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
          doc.text(String(cell), x, y, { width: colWidths[i] });
        });
        y += 14;
      }
      doc.y = y + 5;
    }

    doc.fontSize(18).text("Manager Dashboard");
    doc
      .fontSize(9)
      .fillColor("gray")
      .text(`Generated ${formatIstDate(now)} · Period: ${formatIstDate(from)} – ${formatIstDate(to)}`);
    doc.fillColor("black");

    heading("Overview");
    table(
      ["Metric", "Value"],
      [
        ["Total Leads", totalLeads],
        ["Active for Onboarding", activeClients],
        ["On-Hold", onHoldClients],
        ["Completed", completedClients],
        ["Avg Onboarding Time", avgOnboardingDays > 0 ? `${avgOnboardingDays}d` : "—"],
        ["SLA Compliance", `${slaCompliance}%`],
      ],
      [250, 150],
    );

    heading("Pipeline View");
    table(
      ["Stage", "Clients", "Conversion %", "Avg Time in Stage"],
      funnelData.map((f) => {
        const conv = conversionByStageId.get(f.stageId);
        const dur = stageDurationByStageId.get(f.stageId);
        return [
          f.stage,
          f.count,
          conv ? `${conv.pct}%` : "—",
          dur ? (dur.avgHours < 24 ? `${Math.round(dur.avgHours)}h` : `${Math.round((dur.avgHours / 24) * 10) / 10}d`) : "—",
        ];
      }),
      [260, 90, 110, 140],
    );

    heading("Leads Activity");
    table(
      ["Period", "Created", "Updated"],
      leadsActivityBuckets.map((b) => [b.label, b.created, b.updated]),
      [250, 100, 100],
    );

    // 15 data columns don't fit legibly in one table at A4 landscape's ~762pt usable width (the
    // prior 12-column Team Performance table already used ~765pt) — stacked as two RM-keyed tables
    // using the same table() helper instead of inventing a column-balancing renderer.
    heading("Performance Overview");
    table(
      ["RM", "Active", "Completed", "On-Hold", "SLA %", "Overdue Tasks", "Avg Onboarding Days", "Capacity"],
      rmPerformance.map((row) => [
        row.rm.name,
        row.active,
        row.completed,
        row.onHold,
        `${row.rmSlaPct}%`,
        row.overdueTasks,
        row.rmAvgDays > 0 ? `${row.rmAvgDays}d` : "—",
        row.rm.capacity ?? "—",
      ]),
      [130, 55, 70, 60, 50, 75, 95, 70],
    );

    heading("Activity & Business Metrics");
    table(
      ["RM", "Leads Assigned", "Contacted", "Meetings", "Follow-ups", "KYC", "Funds Received", "Investments"],
      rmPerformance.map((row) => {
        const activity = activityByRm.get(row.rm.id);
        return [
          row.rm.name,
          activity?.leadsAssigned ?? 0,
          activity?.clientsContacted ?? 0,
          activity?.meetingsCompleted ?? 0,
          activity?.followUpsCompleted ?? 0,
          activity?.kycCompleted ?? 0,
          `₹${Math.round(activity?.fundsReceived ?? 0).toLocaleString("en-IN")}`,
          activity?.investmentsExecuted ?? 0,
        ];
      }),
      [130, 75, 65, 60, 65, 40, 90, 70],
    );

    doc.end();
  });

  const filename = `manager-dashboard-${formatIstDate(now).replace(/\s+/g, "-").toLowerCase()}.pdf`;

  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

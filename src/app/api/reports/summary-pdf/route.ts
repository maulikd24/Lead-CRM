import PDFDocument from "pdfkit";

import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { getReportsPageData } from "@/lib/reports/get-reports-page-data";
import { formatIstDate } from "@/lib/utils/ist-date";
import type { Prisma } from "@/generated/prisma/client";

export async function GET() {
  // Same gate as the Reports page itself (reports/page.tsx) — Admin/Manager only, scoped to the
  // caller's visible clients exactly like the page.
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);
  const clientFilter: Prisma.ClientWhereInput = visibleUserIds
    ? { assignedToId: { in: visibleUserIds }, isDeleted: false }
    : { isDeleted: false };
  const now = new Date();

  const data = await getReportsPageData(clientFilter, visibleUserIds, now);

  const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    function heading(title: string) {
      doc.moveDown(0.75);
      doc.fontSize(14).text(title, { underline: true });
      doc.fontSize(10);
    }

    function table(headers: string[], rows: (string | number)[][], colWidths: number[]) {
      const startX = doc.x;
      let y = doc.y + 4;
      doc.fontSize(9).font("Helvetica-Bold");
      headers.forEach((h, i) => {
        const x = startX + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
        doc.text(h, x, y, { width: colWidths[i] });
      });
      y += 16;
      doc.font("Helvetica").fontSize(9);
      for (const row of rows) {
        if (y > 750) {
          doc.addPage();
          y = 50;
        }
        row.forEach((cell, i) => {
          const x = startX + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
          doc.text(String(cell), x, y, { width: colWidths[i] });
        });
        y += 15;
      }
      doc.y = y + 5;
    }

    doc.fontSize(18).text("Reports Summary");
    doc.fontSize(10).fillColor("gray").text(`Generated ${formatIstDate(now)}`);
    doc.fillColor("black");

    heading("Overview");
    table(
      ["Metric", "Value"],
      [
        ["Total Leads", data.totalLeads],
        ["Active Onboarding", data.activeClients],
        ["Completed", data.completedClients],
        ["Not Proceeding", data.notProceedingClients],
        ["On Hold", data.onHoldClients],
        ["Overdue", data.overdueCount],
        ["SLA Compliance", `${data.slaCompliance}%`],
        ["Avg Onboarding Time", data.avgOnboardingDays > 0 ? `${data.avgOnboardingDays}d` : "—"],
      ],
      [250, 150],
    );

    heading("Stage Funnel");
    table(
      ["Stage", "Count"],
      data.funnelData.map((r) => [r.stage, r.count]),
      [300, 100],
    );

    heading("SLA Breach & Overdue — By Stage");
    table(
      ["Stage", "Overdue", "Due Soon"],
      data.slaByStage.map((r) => [r.label, r.overdue, r.dueSoon]),
      [250, 100, 100],
    );

    heading("SLA Breach & Overdue — By RM");
    table(
      ["RM", "Overdue", "Due Soon"],
      data.slaByRm.map((r) => [r.label, r.overdue, r.dueSoon]),
      [250, 100, 100],
    );

    heading("Stage Conversion");
    table(
      ["Stage", "Reached", "% of Stage 1"],
      data.conversionData.map((r) => [r.stage, r.reached, `${r.pct}%`]),
      [250, 100, 100],
    );

    heading("Bottleneck Analysis");
    table(
      ["Stage", "Avg Time in Stage", "Sample"],
      data.stageDurations.map((r) => [
        r.stageName,
        r.avgHours < 24 ? `${Math.round(r.avgHours)}h` : `${Math.round((r.avgHours / 24) * 10) / 10}d`,
        r.sampleSize,
      ]),
      [250, 150, 100],
    );

    heading("Lost Reasons");
    table(
      ["Reason", "Count"],
      data.lostReasonGroups.length ? data.lostReasonGroups.map((r) => [r.reason ?? "Unspecified", r.count]) : [["No clients marked not proceeding yet.", ""]],
      [350, 100],
    );

    heading("Source Performance");
    table(
      ["Source", "Completed / Total", "%"],
      data.sourcePerformance.map((r) => [r.source, `${r.completed}/${r.total}`, r.total > 0 ? `${Math.round((r.completed / r.total) * 100)}%` : "0%"]),
      [250, 150, 100],
    );

    heading("RM Performance");
    table(
      ["RM", "Active", "Completed", "Overdue Tasks", "SLA %", "Avg Onboarding Days"],
      data.rmPerformance.map((r) => [r.rm.name, r.active, r.completed, r.overdueTasks, `${r.rmSlaPct}%`, r.rmAvgDays > 0 ? `${r.rmAvgDays}d` : "—"]),
      [130, 60, 70, 90, 60, 100],
    );

    doc.end();
  });

  const filename = `reports-summary-${formatIstDate(now).replace(/\s+/g, "-").toLowerCase()}.pdf`;

  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

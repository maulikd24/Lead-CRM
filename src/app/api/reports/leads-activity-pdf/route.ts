import PDFDocument from "pdfkit";

import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { getLeadsActivity } from "@/lib/reports/leads-activity";
import { parseManagementPeriodParams, granularityForPeriod } from "@/lib/reports/period-range";
import { formatIstDate } from "@/lib/utils/ist-date";
import type { Prisma } from "@/generated/prisma/client";

/**
 * PDF export for the Manager Dashboard's Leads Activity section (decision: swap CSV for PDF there).
 * Driven by the same `?period=`/`?anchor=` params the dashboard page itself uses, via the shared
 * period-range helper, so this can't drift from what the chart shows. A plain data table (Period |
 * Created | Updated) — no chart-image embedding, matching this codebase's existing table-only PDF
 * style (management-dashboard-pdf/route.ts).
 */
export async function GET(request: Request) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);
  const clientFilter: Prisma.ClientWhereInput = visibleUserIds
    ? { assignedToId: { in: visibleUserIds }, isDeleted: false }
    : { isDeleted: false };
  const now = new Date();

  const url = new URL(request.url);
  const { granularity, from, to } = parseManagementPeriodParams(url.searchParams, now);
  const buckets = await getLeadsActivity({ from, to, granularity: granularityForPeriod(granularity), clientWhere: clientFilter });

  const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
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
      const startX = marginLeft;
      let y = doc.y + 4;
      doc.fontSize(9).font("Helvetica-Bold");
      headers.forEach((h, i) => {
        const x = startX + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
        doc.text(h, x, y, { width: colWidths[i] });
      });
      y += 16;
      doc.font("Helvetica").fontSize(9);
      for (const row of rows) {
        if (y > 700) {
          doc.addPage();
          y = 50;
        }
        row.forEach((cell, i) => {
          const x = startX + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
          doc.text(String(cell), x, y, { width: colWidths[i] });
        });
        y += 16;
      }
      doc.y = y + 5;
    }

    doc.fontSize(18).text("Leads Activity");
    doc
      .fontSize(9)
      .fillColor("gray")
      .text(`Generated ${formatIstDate(now)} · Period: ${formatIstDate(from)} – ${formatIstDate(to)}`);
    doc.fillColor("black");

    heading("Activity by Period");
    table(
      ["Period", "Created", "Updated"],
      buckets.map((b) => [b.label, b.created, b.updated]),
      [250, 100, 100],
    );

    doc.end();
  });

  const filename = `leads-activity-${formatIstDate(now).replace(/\s+/g, "-").toLowerCase()}.pdf`;

  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

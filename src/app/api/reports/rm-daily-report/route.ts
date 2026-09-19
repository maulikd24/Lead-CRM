import PDFDocument from "pdfkit";

import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { generateRmDailyReport } from "@/lib/reports/rm-daily-report";
import { formatDate } from "@/lib/utils/format";

const OPPORTUNITY_PLACEHOLDER = "Available once Opportunity Management ships";

export async function GET(request: Request) {
  // Same gate as the RM drill-down page itself (reports/rm/[id]/page.tsx) — Admin/Manager only,
  // and scoped to the caller's visible RMs so a Manager can't pull another manager's RM via a
  // crafted URL, mirroring the existing leads-summary CSV export route's convention.
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);

  const url = new URL(request.url);
  const rmId = url.searchParams.get("rmId");
  if (!rmId) return new Response("Missing rmId", { status: 400 });
  if (visibleUserIds && !visibleUserIds.includes(rmId)) return new Response("Not found", { status: 404 });

  const dateParam = url.searchParams.get("date");
  const date = dateParam ? new Date(`${dateParam}T00:00:00`) : new Date();

  const report = await generateRmDailyReport(rmId, date);

  const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    function section(title: string, lines: string[]) {
      doc.moveDown(0.5);
      doc.fontSize(13).text(title, { underline: true });
      doc.fontSize(11);
      for (const line of lines) doc.text(`• ${line}`);
    }

    doc.fontSize(16).text(`RM Daily Report — ${formatDate(report.date)}`);
    doc.fontSize(11).text(`RM: ${report.rmName}`);

    section("Client Activity", [
      `Clients contacted: ${report.clientActivity.clientsContacted}`,
      `Meetings completed: ${report.clientActivity.meetingsCompleted}`,
      `Follow-ups completed: ${report.clientActivity.followUpsCompleted}`,
      `Overdue follow-ups: ${report.clientActivity.overdueFollowUps}`,
    ]);

    section("Client Progress", [
      `KYC completed: ${report.clientProgress.kycCompleted}`,
      `Wealth Health Checkup completed: ${OPPORTUNITY_PLACEHOLDER}`,
      `Smart Allvest completed: ${OPPORTUNITY_PLACEHOLDER}`,
      `Recommendations discussed: ${OPPORTUNITY_PLACEHOLDER}`,
      `Clients funded: ${report.clientProgress.clientsFunded}`,
      `Investments completed: ${report.clientProgress.investmentsCompleted}`,
    ]);

    section("Business", [
      `New potential identified: ${OPPORTUNITY_PLACEHOLDER}`,
      `Funds committed: ${OPPORTUNITY_PLACEHOLDER}`,
      `Funds received: ₹${report.business.fundsReceived.toLocaleString("en-IN")}`,
      `Investment completed: ₹${report.business.investmentCompleted.toLocaleString("en-IN")}`,
    ]);

    section(
      "Priority Clients",
      report.priorityClients.length
        ? report.priorityClients.map((c) => `${c.name} (${c.clientCode}) — ${OPPORTUNITY_PLACEHOLDER}`)
        : ["None"],
    );

    section("Blockers", report.blockers.length ? report.blockers.map((b) => `${b.clientName} — ${b.reason}`) : ["None"]);

    section("Tomorrow's Priorities", [
      `${report.tomorrowsPriorities.followUps} scheduled follow-ups`,
      `${report.tomorrowsPriorities.meetings} portfolio meetings`,
      `${report.tomorrowsPriorities.funding} funding follow-up / key tasks`,
    ]);

    doc.end();
  });

  const filenameSafeName = report.rmName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const filename = `rm-daily-report-${filenameSafeName}-${report.date.toISOString().slice(0, 10)}.pdf`;

  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { getEmailAdapter } from "@/lib/integrations/registry";
import { getLeadsActivity } from "@/lib/reports/leads-activity";
import { generateRmDailyReport, type RmDailyReport } from "@/lib/reports/rm-daily-report";
import { istShifted, formatIstDate } from "@/lib/utils/ist-date";

const OPPORTUNITY_PLACEHOLDER = "Available once Opportunity Management ships";

function renderRmDailyReportText(report: RmDailyReport): string {
  return [
    `RM DAILY REPORT — ${formatIstDate(report.date)}`,
    `RM: ${report.rmName}`,
    "",
    "Client Activity",
    `- Clients contacted: ${report.clientActivity.clientsContacted}`,
    `- Meetings completed: ${report.clientActivity.meetingsCompleted}`,
    `- Follow-ups completed: ${report.clientActivity.followUpsCompleted}`,
    `- Overdue follow-ups: ${report.clientActivity.overdueFollowUps}`,
    "",
    "Client Progress",
    `- KYC completed: ${report.clientProgress.kycCompleted}`,
    `- Wealth Health Checkup completed: ${OPPORTUNITY_PLACEHOLDER}`,
    `- Smart Allvest completed: ${OPPORTUNITY_PLACEHOLDER}`,
    `- Recommendations discussed: ${OPPORTUNITY_PLACEHOLDER}`,
    `- Clients funded: ${report.clientProgress.clientsFunded}`,
    `- Investments completed: ${report.clientProgress.investmentsCompleted}`,
    "",
    "Business",
    `- New potential identified: ${OPPORTUNITY_PLACEHOLDER}`,
    `- Funds committed: ${OPPORTUNITY_PLACEHOLDER}`,
    `- Funds received: ₹${report.business.fundsReceived.toLocaleString("en-IN")}`,
    `- Investment completed: ₹${report.business.investmentCompleted.toLocaleString("en-IN")}`,
    "",
    "Priority Clients",
    ...(report.priorityClients.length
      ? report.priorityClients.map((c) => `- ${c.name} (${c.clientCode}) — ${OPPORTUNITY_PLACEHOLDER}`)
      : ["- None"]),
    "",
    "Blockers",
    ...(report.blockers.length ? report.blockers.map((b) => `- ${b.clientName} — ${b.reason}`) : ["- None"]),
    "",
    "Tomorrow's Priorities",
    `- ${report.tomorrowsPriorities.followUps} scheduled follow-ups`,
    `- ${report.tomorrowsPriorities.meetings} portfolio meetings`,
    `- ${report.tomorrowsPriorities.funding} funding follow-up / key tasks`,
  ].join("\n");
}

/** Best-effort per-RM send — one RM's failure (or a bad email address) must never block the
 * others, unlike the single org-wide report above, which has real mutex/retry machinery because
 * losing it for a whole day is a bigger deal than one RM missing one day's personal report. */
async function sendRmDailyReports(now: Date): Promise<{ sent: number; failed: number }> {
  const rms = await prisma.user.findMany({ where: { role: "RM", isActive: true }, select: { id: true, email: true } });
  const adapter = await getEmailAdapter();
  let sent = 0;
  let failed = 0;
  for (const rm of rms) {
    try {
      const report = await generateRmDailyReport(rm.id, now);
      const text = renderRmDailyReportText(report);
      const result = await adapter.sendEmail({
        to: [rm.email],
        subject: `Your Daily RM Report — ${formatIstDate(now)}`,
        html: `<pre style="font-family: inherit; white-space: pre-wrap;">${text}</pre>`,
        text,
      });
      if (result.success) sent += 1;
      else failed += 1;
    } catch (error) {
      console.error(`Failed to send RM daily report to ${rm.email}:`, error);
      failed += 1;
    }
  }
  return { sent, failed };
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // kept alongside istShifted (shared, ist-date.ts) for the `from` computation below
const TARGET_IST_HOUR = 21; // 9 PM IST
const JOB_NAME = "daily_leads_report";

/** Notifies every active Admin that the daily report failed to actually send — the same
 * "fan out to Admins" idiom used for auto-assign failures (clients/actions.ts) and bug reports
 * (debugger/actions.ts), so a silent send failure is no longer silent. */
async function notifyAdminsOfSendFailure(errorMessage: string) {
  const admins = await prisma.user.findMany({ where: { isActive: true, role: "ADMIN" }, select: { id: true } });
  await Promise.all(
    admins.map((admin) =>
      prisma.notification.create({
        data: { userId: admin.id, type: "daily_report_send_failed", payload: { error: errorMessage } },
      }),
    ),
  );
}

/**
 * Sends a once-daily leads created/updated digest at 9 PM IST to a single fixed recipient
 * configured via DAILY_REPORT_RECIPIENT_EMAIL (operator-supplied post-deploy — never hardcoded).
 * No-ops if that env var is unset, if it's not currently the target hour, or if today's report
 * was already sent — matches the "never throws, degrades gracefully" pattern already established
 * in send-sla-breach-email.ts. Idempotency is enforced by DailyJobRun's unique constraint, which
 * doubles as a concurrency-safe mutex: a P2002 from a concurrent tick just means skip.
 *
 * The mutex is only kept claimed once the send is CONFIRMED successful — resendEmailAdapter
 * doesn't throw on a failed Resend API call, it returns { success: false, error }, and a version
 * of this function that didn't check that return value would report "sent" regardless and burn
 * the day's only mutex on a send that never actually happened. If the send fails for any reason,
 * the claimed DailyJobRun row is deleted so a later tick within the same 21:00-21:59 IST window
 * can retry, and every Admin is notified with the real error rather than the failure going unseen.
 */
export async function sendDailyReportEmail() {
  const now = new Date();
  const ist = istShifted(now);
  if (ist.getUTCHours() !== TARGET_IST_HOUR) return { skipped: "not-time" as const };

  const recipient = process.env.DAILY_REPORT_RECIPIENT_EMAIL;
  if (!recipient) return { skipped: "no-recipient" as const };

  const ranForDate = ist.toISOString().slice(0, 10);
  try {
    await prisma.dailyJobRun.create({ data: { jobName: JOB_NAME, ranForDate } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { skipped: "already-sent" as const };
    }
    throw error;
  }

  async function releaseMutexAndReportFailure(errorMessage: string) {
    await prisma.dailyJobRun.deleteMany({ where: { jobName: JOB_NAME, ranForDate } });
    console.error("Failed to send daily report email:", errorMessage);
    await notifyAdminsOfSendFailure(errorMessage);
    return { error: "send-failed" as const, detail: errorMessage };
  }

  try {
    const from = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS);
    const [today] = await getLeadsActivity({ from, to: now, granularity: "day" });
    const created = today?.created ?? 0;
    const updated = today?.updated ?? 0;

    const adapter = await getEmailAdapter();
    const result = await adapter.sendEmail({
      to: [recipient],
      subject: `Daily Leads Report — ${formatIstDate(now)}`,
      html: `<p>Leads created today: <b>${created}</b></p><p>Leads updated today: <b>${updated}</b></p>`,
      text: `Leads created today: ${created}. Leads updated today: ${updated}.`,
    });
    if (!result.success) return releaseMutexAndReportFailure(result.error ?? "Unknown error from email adapter");

    const rmReports = await sendRmDailyReports(now);

    return { sent: true as const, created, updated, rmReports };
  } catch (error) {
    return releaseMutexAndReportFailure(error instanceof Error ? error.message : "Unknown error");
  }
}

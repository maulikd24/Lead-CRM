import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { getEmailAdapter } from "@/lib/integrations/registry";
import { assembleManagementReportData, renderManagementReportText } from "@/lib/reports/management-report";
import { notifyAdminsOfSendFailure } from "@/lib/notifications/send-daily-report-email";
import { istShifted, istWeekBoundaries, istWeekKey, istMonthBoundaries, istMonthKey, formatIstDate } from "@/lib/utils/ist-date";

const TARGET_IST_HOUR = 21; // same 9 PM IST slot as the daily report — independent sends, same tick

/**
 * Module 6 of the RM/Wealth CRM spec: weekly and monthly rollups on top of the same
 * DailyJobRun-mutex/single-fixed-recipient/never-throws pattern already hardened for the daily
 * report (send-daily-report-email.ts) — just keyed by ISO week/month instead of calendar day, and
 * reusing assembleManagementReportData/renderManagementReportText so none of the aggregation or
 * rendering logic is duplicated a third time.
 */

const WEEKLY_JOB_NAME = "weekly_management_report";

/** Fires once, Monday at 9 PM IST, summarizing the week that just ended (last Monday through
 * yesterday). Recipient reuses DAILY_REPORT_RECIPIENT_EMAIL — no separate env var, since this is
 * the same "management" audience as the daily digest, just a coarser rollup. */
export async function sendWeeklyManagementReport() {
  const now = new Date();
  const ist = istShifted(now);
  if (ist.getUTCHours() !== TARGET_IST_HOUR) return { skipped: "not-time" as const };
  if (ist.getUTCDay() !== 1) return { skipped: "not-monday" as const };

  const recipient = process.env.DAILY_REPORT_RECIPIENT_EMAIL;
  if (!recipient) return { skipped: "no-recipient" as const };

  const ranForDate = istWeekKey(now);
  try {
    await prisma.dailyJobRun.create({ data: { jobName: WEEKLY_JOB_NAME, ranForDate } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { skipped: "already-sent" as const };
    }
    throw error;
  }

  async function releaseMutexAndReportFailure(errorMessage: string) {
    await prisma.dailyJobRun.deleteMany({ where: { jobName: WEEKLY_JOB_NAME, ranForDate } });
    console.error("Failed to send weekly management report:", errorMessage);
    await notifyAdminsOfSendFailure(errorMessage, "weekly_report_send_failed");
    return { error: "send-failed" as const, detail: errorMessage };
  }

  try {
    const { weekStart: thisWeekStart } = istWeekBoundaries(now);
    const from = new Date(thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
    const to = thisWeekStart;
    const periodLabel = `Week of ${formatIstDate(from)} – ${formatIstDate(new Date(to.getTime() - 1))}`;

    const reportData = await assembleManagementReportData(periodLabel, from, to, now);
    const text = renderManagementReportText(reportData);

    const adapter = await getEmailAdapter();
    const result = await adapter.sendEmail({
      to: [recipient],
      subject: `Weekly Management Report — ${periodLabel}`,
      html: `<pre style="font-family: inherit; white-space: pre-wrap;">${text}</pre>`,
      text,
    });
    if (!result.success) return releaseMutexAndReportFailure(result.error ?? "Unknown error from email adapter");

    return { sent: true as const, periodLabel };
  } catch (error) {
    return releaseMutexAndReportFailure(error instanceof Error ? error.message : "Unknown error");
  }
}

const MONTHLY_JOB_NAME = "monthly_management_report";

/** Fires once, on the 1st of the IST calendar month at 9 PM IST, summarizing the month that just
 * ended. */
export async function sendMonthlyManagementReport() {
  const now = new Date();
  const ist = istShifted(now);
  if (ist.getUTCHours() !== TARGET_IST_HOUR) return { skipped: "not-time" as const };
  if (ist.getUTCDate() !== 1) return { skipped: "not-first-of-month" as const };

  const recipient = process.env.DAILY_REPORT_RECIPIENT_EMAIL;
  if (!recipient) return { skipped: "no-recipient" as const };

  const ranForDate = istMonthKey(now);
  try {
    await prisma.dailyJobRun.create({ data: { jobName: MONTHLY_JOB_NAME, ranForDate } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { skipped: "already-sent" as const };
    }
    throw error;
  }

  async function releaseMutexAndReportFailure(errorMessage: string) {
    await prisma.dailyJobRun.deleteMany({ where: { jobName: MONTHLY_JOB_NAME, ranForDate } });
    console.error("Failed to send monthly management report:", errorMessage);
    await notifyAdminsOfSendFailure(errorMessage, "monthly_report_send_failed");
    return { error: "send-failed" as const, detail: errorMessage };
  }

  try {
    const { monthStart: thisMonthStart } = istMonthBoundaries(now);
    const { monthStart: from } = istMonthBoundaries(new Date(thisMonthStart.getTime() - 24 * 60 * 60 * 1000));
    const to = thisMonthStart;
    const periodLabel = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(from);

    const reportData = await assembleManagementReportData(periodLabel, from, to, now);
    const text = renderManagementReportText(reportData);

    const adapter = await getEmailAdapter();
    const result = await adapter.sendEmail({
      to: [recipient],
      subject: `Monthly Management Report — ${periodLabel}`,
      html: `<pre style="font-family: inherit; white-space: pre-wrap;">${text}</pre>`,
      text,
    });
    if (!result.success) return releaseMutexAndReportFailure(result.error ?? "Unknown error from email adapter");

    return { sent: true as const, periodLabel };
  } catch (error) {
    return releaseMutexAndReportFailure(error instanceof Error ? error.message : "Unknown error");
  }
}

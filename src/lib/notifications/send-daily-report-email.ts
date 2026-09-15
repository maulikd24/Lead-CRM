import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { getEmailAdapter } from "@/lib/integrations/registry";
import { getLeadsActivity } from "@/lib/reports/leads-activity";
import { formatDate } from "@/lib/utils/format";

// India is a fixed UTC+5:30 offset with no DST — a manual shift is correct forever for this
// India-only app. Do not copy this pattern into a feature that needs real timezone handling.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const TARGET_IST_HOUR = 21; // 9 PM IST
const JOB_NAME = "daily_leads_report";

function istShifted(date: Date): Date {
  return new Date(date.getTime() + IST_OFFSET_MS);
}

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
      subject: `Daily Leads Report — ${formatDate(now)}`,
      html: `<p>Leads created today: <b>${created}</b></p><p>Leads updated today: <b>${updated}</b></p>`,
      text: `Leads created today: ${created}. Leads updated today: ${updated}.`,
    });
    if (!result.success) return releaseMutexAndReportFailure(result.error ?? "Unknown error from email adapter");

    return { sent: true as const, created, updated };
  } catch (error) {
    return releaseMutexAndReportFailure(error instanceof Error ? error.message : "Unknown error");
  }
}

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

/**
 * Sends a once-daily leads created/updated digest at 9 PM IST to a single fixed recipient
 * configured via DAILY_REPORT_RECIPIENT_EMAIL (operator-supplied post-deploy — never hardcoded).
 * No-ops if that env var is unset, if it's not currently the target hour, or if today's report
 * was already sent — matches the "never throws, degrades gracefully" pattern already established
 * in send-sla-breach-email.ts. Idempotency is enforced by DailyJobRun's unique constraint, which
 * doubles as a concurrency-safe mutex: a P2002 from a concurrent tick just means skip.
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

  try {
    const from = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS);
    const [today] = await getLeadsActivity({ from, to: now, granularity: "day" });
    const created = today?.created ?? 0;
    const updated = today?.updated ?? 0;

    const adapter = await getEmailAdapter();
    await adapter.sendEmail({
      to: [recipient],
      subject: `Daily Leads Report — ${formatDate(now)}`,
      html: `<p>Leads created today: <b>${created}</b></p><p>Leads updated today: <b>${updated}</b></p>`,
      text: `Leads created today: ${created}. Leads updated today: ${updated}.`,
    });
    return { sent: true as const, created, updated };
  } catch (error) {
    console.error("Failed to send daily report email", error);
    return { error: "send-failed" as const };
  }
}

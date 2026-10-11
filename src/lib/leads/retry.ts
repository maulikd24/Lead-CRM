import { prisma } from "@/lib/db/prisma";
import { getLeadIntakeConfig } from "@/lib/leads/config";
import { processLead, type LeadInput } from "@/lib/leads/ingest";
import { retryParkedMetaLead, type LeadgenChange } from "@/lib/leads/meta";

const MAX_ATTEMPTS = 5;
export const MAX_LEAD_ATTEMPTS = MAX_ATTEMPTS;
const MIN_AGE_MS = 2 * 60 * 1000;
const BATCH = 50;

/**
 * Cron: re-runs leads that failed part-way (database blip, Graph API outage). Rows are only touched once they are a
 * couple of minutes old so an in-flight request isn't raced, and give up after MAX_ATTEMPTS — those stay visible as
 * "failed leads" on the Go-Live page for a human to look at.
 */
export async function retryFailedLeads(now = new Date()) {
  const rows = await prisma.leadIntake.findMany({
    where: { status: "ERROR", attempts: { lt: MAX_ATTEMPTS }, receivedAt: { lt: new Date(now.getTime() - MIN_AGE_MS) } },
    orderBy: { receivedAt: "asc" },
    take: BATCH,
  });
  if (rows.length === 0) return { retried: 0, recovered: 0 };

  const config = await getLeadIntakeConfig();
  let recovered = 0;
  for (const row of rows) {
    await prisma.leadIntake.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    if (await reprocess(row, config)) recovered += 1;
  }
  return { retried: rows.length, recovered };
}

type IntakeRow = { rawPayload: unknown; id: string };

/** The per-row body of the cron retry: true when the lead is no longer in error. */
async function reprocess(row: IntakeRow, config: Awaited<ReturnType<typeof getLeadIntakeConfig>>): Promise<boolean> {
  const raw = row.rawPayload as { pendingFetch?: LeadgenChange; normalized?: LeadInput } | null;
  const outcome = raw?.pendingFetch
    ? await retryParkedMetaLead(raw.pendingFetch, config.metaPageToken)
    : raw?.normalized
      ? await processLead(row.id, raw.normalized)
      : { status: "error" as const, error: "Nothing to retry" };
  return outcome.status !== "error";
}

export type RetryLeadResult = { outcome: "recovered" | "still-failing" | "dead" | "not-failed" | "not-found" | "busy" };

/**
 * Admin retry of ONE failed lead (control plane Failures tab): the same operation the cron performs for every failed lead, sooner.
 * Safe to click twice: the attempt is claimed with a conditional update on the attempt count we read, so a concurrent second click
 * loses the claim, and once a lead is no longer in error a retry does nothing. Capped at MAX_ATTEMPTS like the cron.
 */
export async function retryLeadIntake(id: string): Promise<RetryLeadResult> {
  const row = await prisma.leadIntake.findUnique({ where: { id } });
  if (!row) return { outcome: "not-found" };
  if (row.status !== "ERROR") return { outcome: "not-failed" };
  if (row.attempts >= MAX_ATTEMPTS) return { outcome: "dead" };
  const claim = await prisma.leadIntake.updateMany({ where: { id, status: "ERROR", attempts: row.attempts }, data: { attempts: { increment: 1 } } });
  if (claim.count === 0) return { outcome: "busy" };
  const config = await getLeadIntakeConfig();
  return { outcome: (await reprocess(row, config)) ? "recovered" : "still-failing" };
}

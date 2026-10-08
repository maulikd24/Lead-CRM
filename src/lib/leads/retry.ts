import { prisma } from "@/lib/db/prisma";
import { getLeadIntakeConfig } from "@/lib/leads/config";
import { processLead, type LeadInput } from "@/lib/leads/ingest";
import { retryParkedMetaLead, type LeadgenChange } from "@/lib/leads/meta";

const MAX_ATTEMPTS = 5;
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
    const raw = row.rawPayload as { pendingFetch?: LeadgenChange; normalized?: LeadInput } | null;
    await prisma.leadIntake.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    const outcome = raw?.pendingFetch
      ? await retryParkedMetaLead(raw.pendingFetch, config.metaPageToken)
      : raw?.normalized
        ? await processLead(row.id, raw.normalized)
        : { status: "error" as const, error: "Nothing to retry" };
    if (outcome.status !== "error") recovered += 1;
  }
  return { retried: rows.length, recovered };
}

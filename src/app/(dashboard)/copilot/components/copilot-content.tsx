import { prisma } from "@/lib/db/prisma";
import { buildWorklist } from "@/lib/copilot/worklist";
import { PageHeader } from "@/components/shared/page-header";
import { CopilotSummary } from "./copilot-summary";
import { CopilotWorklist } from "./copilot-worklist";
import { PriorityCustomers, type PriorityFilters } from "./priority-customers";
import { PriorityClients } from "./priority-clients";
import { CopilotAsk } from "./copilot-ask";
import { SUPPORTED_QUESTIONS } from "@/lib/intelligence/ask-intents";
import { rmPriorityClientsEnabled } from "@/lib/priority/flag";

/** Fetches the worklist once and feeds both the summary strip and the table — avoids running the same scoring queries twice. */
export async function CopilotContent({ visibleUserIds, includeUnassigned, canAsk: askAllowed, filters }: { visibleUserIds: string[] | null; includeUnassigned: boolean; canAsk: boolean; filters: PriorityFilters }) {
  const [{ entries, summary }, users] = await Promise.all([
    buildWorklist(visibleUserIds),
    prisma.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Co-pilot" description="Who needs attention right now, and what to do next." />
      <CopilotSummary summary={summary} />
      <CopilotAsk canAsk={askAllowed} supported={SUPPORTED_QUESTIONS} />
      {rmPriorityClientsEnabled() ? <PriorityClients visibleUserIds={visibleUserIds} includeUnassigned={includeUnassigned} /> : null}
      <PriorityCustomers visibleUserIds={visibleUserIds} includeUnassigned={includeUnassigned} filters={filters} />
      <CopilotWorklist entries={entries} users={users} />
    </div>
  );
}

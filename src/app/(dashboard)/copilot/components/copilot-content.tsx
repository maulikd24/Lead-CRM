import { prisma } from "@/lib/db/prisma";
import { loadCopilotList } from "@/lib/copilot/merged-list";
import type { CopilotQuery } from "@/lib/copilot/list-view";
import { PageHeader } from "@/components/shared/page-header";
import { CopilotSummary } from "./copilot-summary";
import { CopilotList } from "./copilot-worklist";
import { PriorityClients } from "./priority-clients";
import { CopilotAsk } from "./copilot-ask";
import { SUPPORTED_QUESTIONS } from "@/lib/intelligence/ask-intents";
import { rmPriorityClientsEnabled } from "@/lib/priority/flag";

/** Loads the merged list once and feeds the summary strip and the single table. Admins see one table; the ranked Priority clients card (flagged) is for RMs and Managers. */
export async function CopilotContent({ visibleUserIds, includeUnassigned, canAsk: askAllowed, query, role }: { visibleUserIds: string[] | null; includeUnassigned: boolean; canAsk: boolean; query: CopilotQuery; role: string }) {
  const [{ rows, entries, summary }, users, stages] = await Promise.all([
    loadCopilotList(visibleUserIds, includeUnassigned),
    prisma.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.stage.findMany({ where: { isActive: true }, orderBy: { sequence: "asc" }, select: { name: true } }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Co-pilot" description="Who needs attention right now, and what to do next." />
      <CopilotSummary summary={summary} />
      <CopilotAsk canAsk={askAllowed} supported={SUPPORTED_QUESTIONS} />
      {role !== "ADMIN" && rmPriorityClientsEnabled() ? <PriorityClients visibleUserIds={visibleUserIds} includeUnassigned={includeUnassigned} /> : null}
      <CopilotList rows={rows} entries={entries} users={users} query={query} stages={stages.map((s) => s.name)} showRm={role === "MANAGER" || role === "ADMIN"} />
    </div>
  );
}

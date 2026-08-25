import { prisma } from "@/lib/db/prisma";
import { buildWorklist } from "@/lib/copilot/worklist";
import { CopilotSummary } from "./copilot-summary";
import { CopilotWorklist } from "./copilot-worklist";

/** Fetches the worklist once and feeds both the summary strip and the table — avoids running the same scoring queries twice. */
export async function CopilotContent({ visibleUserIds }: { visibleUserIds: string[] | null }) {
  const [{ entries, summary }, users] = await Promise.all([
    buildWorklist(visibleUserIds),
    prisma.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <CopilotSummary summary={summary} />
      <CopilotWorklist entries={entries} users={users} />
    </div>
  );
}

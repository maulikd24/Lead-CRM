import Link from "next/link";

import { requireRole } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { PILOT_STATEMENT, PILOT_STATEMENT_VERSION } from "@/lib/agents/pilot";
import { loadPilotState } from "@/lib/agents/pilot-service";
import { pilotDb } from "@/lib/agents/pilot-wiring";
import { formatDateTime } from "@/lib/utils/format";
import { PageHeader } from "@/components/shared/page-header";
import { PilotView } from "./pilot-view";

export const dynamic = "force-dynamic";

export default async function AiPilotPage() {
  await requireRole(["ADMIN"]);
  const state = await loadPilotState(pilotDb);
  const names = await prisma.user.findMany({
    where: { id: { in: [state.aiKey?.savedById, state.signoff?.acknowledgedById, state.signoffAwaiting?.complianceById].filter((x): x is string => !!x) } },
    select: { id: true, name: true },
  });
  const nameOf = (id: string | undefined) => names.find((n) => n.id === id)?.name ?? null;
  const listed = new Set(state.users.map((u) => u.userId));
  const candidates = (await prisma.user.findMany({ where: { isActive: true, role: { in: ["RM", "ADMIN"] } }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" }, take: 500 })).filter((u) => !listed.has(u.id));

  return (
      <PilotView
        header={
          <PageHeader
            title="Reply assistant pilot"
            description="Who may use the draft-only reply assistant, and what must be in place first."
            actions={<Link href="/agents?tab=rules" className="text-xs font-medium text-muted-foreground underline">Agent switches</Link>}
          />
        }
        statementVersion={PILOT_STATEMENT_VERSION}
        statement={[...PILOT_STATEMENT]}
        envOn={process.env.WA_ASSIST_ENABLED === "1"}
        agentOn={state.agentOn}
        missing={state.readiness.missing}
        aiKey={state.aiKey ? { last4: state.aiKey.last4, savedAt: formatDateTime(state.aiKey.savedAt), savedByName: nameOf(state.aiKey.savedById) } : null}
        signoff={state.signoff ? { byName: state.signoff.acknowledgedByName, at: formatDateTime(state.signoff.acknowledgedAt), complianceByName: state.signoff.complianceByName } : null}
        awaiting={state.signoffAwaiting ? { byName: state.signoffAwaiting.complianceByName, at: formatDateTime(state.signoffAwaiting.complianceAt) } : null}
        users={state.users.map((u) => ({ id: u.userId, name: u.name, role: u.role, addedAt: formatDateTime(u.addedAt) }))}
        candidates={candidates}
      />
  );
}

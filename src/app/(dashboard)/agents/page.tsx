import Link from "next/link";
import { LineChart, Sparkles } from "lucide-react";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { expiresInLabel } from "@/lib/agents/format";
import { insightsEnabled } from "@/lib/insights/range";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { ProposalCard } from "./proposal-card";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const session = await requireRole(["ADMIN", "MANAGER", "RM"]);
  const { id, role } = session.user;
  const now = new Date();

  // ADMIN: everything. MANAGER: their visible team's clients (read-only). RM: only clients assigned to them.
  const visible = role === "ADMIN" ? null : await getVisibleUserIds(id, role);
  const clientWhere = visible === null ? {} : { client: { assignedToId: { in: visible } } };

  const drafts = await prisma.agentProposal.findMany({
    where: { status: "DRAFT", agentKey: { not: "wa_reply" }, expiresAt: { gt: now }, ...clientWhere },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, body: true, reason: true, programme: true, expiresAt: true, client: { select: { name: true, clientCode: true } } },
  });

  const canAct = role !== "MANAGER";
  const showInsights = insightsEnabled() && (role === "ADMIN" || role === "MANAGER");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Agent drafts"
        description={canAct ? "Nothing is sent until you approve it." : "Drafts waiting on your team. Only the assigned RM or an Admin can approve."}
        actions={
          showInsights ? (
            <Link href="/agents/insights" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <LineChart className="size-3.5" aria-hidden="true" /> Insights
            </Link>
          ) : undefined
        }
      />
      {drafts.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState icon={Sparkles} title="No drafts waiting" description="Nothing is sent until you approve it." />
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {drafts.map((d) => (
            <ProposalCard
              key={d.id}
              canAct={canAct}
              draft={{
                id: d.id,
                body: d.body,
                reason: d.reason,
                programme: d.programme,
                expiry: expiresInLabel(d.expiresAt, now),
                client: d.client,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

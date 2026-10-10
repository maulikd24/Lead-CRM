import Link from "next/link";
import { LineChart } from "lucide-react";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { expiresInLabel } from "@/lib/agents/format";
import { AGENT_CATALOGUE, agentStatus, envFlagFor, ruleLines } from "@/lib/agents/rules";
import { insightsEnabled } from "@/lib/insights/range";
import { PageHeader } from "@/components/shared/page-header";
import { CountUp, RailFact, StickyRail, TabbedWorkspace, lazyPanels, parseTabParam } from "@/components/workspace";
import { DraftsReview } from "./drafts-review";
import { RulesPanel } from "./rules-panel";
import { SentList } from "./sent-list";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
type SentRow = { id: string; body: string; originalBody: string | null; programme: string | null; decidedAt: Date | null; createdAt: Date; decidedBy: { name: string } | null; client: { name: string; clientCode: string } };
const when = (d: Date) => d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });

const AGENT_TAB_KEYS = ["drafts", "sent", "rules"] as const;

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const { tab: rawTab } = await searchParams;
  // Lazy tabs: the sent history and the kill-switch rows load only when their tab is open (drafts and the weekly counts feed the tab label and rail).
  const openTab = parseTabParam(rawTab, AGENT_TAB_KEYS, "drafts");
  const session = await requireRole(["ADMIN", "MANAGER", "RM"]);
  const { id, role } = session.user;
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * DAY);

  // ADMIN: everything. MANAGER: their visible team's clients (read-only). RM: only clients assigned to them.
  const visible = role === "ADMIN" ? null : await getVisibleUserIds(id, role);
  const clientWhere = visible === null ? {} : { client: { assignedToId: { in: visible } } };

  const [drafts, sent, sentWeek, rejectedWeek, settings] = await Promise.all([
    prisma.agentProposal.findMany({
      where: { status: "DRAFT", agentKey: { not: "wa_reply" }, expiresAt: { gt: now }, ...clientWhere },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, body: true, reason: true, programme: true, expiresAt: true, client: { select: { name: true, clientCode: true } } },
    }),
    openTab !== "sent"
      ? Promise.resolve([] as SentRow[])
      : prisma.agentProposal.findMany({
          where: { status: "SENT", agentKey: { not: "wa_reply" }, ...clientWhere },
          orderBy: { decidedAt: "desc" },
          take: 50,
          select: { id: true, body: true, originalBody: true, programme: true, decidedAt: true, createdAt: true, decidedBy: { select: { name: true } }, client: { select: { name: true, clientCode: true } } },
        }),
    prisma.agentProposal.count({ where: { status: "SENT", agentKey: { not: "wa_reply" }, decidedAt: { gte: weekAgo }, ...clientWhere } }),
    prisma.agentProposal.count({ where: { status: "REJECTED", agentKey: { not: "wa_reply" }, decidedAt: { gte: weekAgo }, ...clientWhere } }),
    openTab !== "rules" ? Promise.resolve([] as { agentKey: string; enabled: boolean }[]) : prisma.agentSetting.findMany({ select: { agentKey: true, enabled: true } }),
  ]);

  const canAct = role !== "MANAGER";
  const showInsights = insightsEnabled() && (role === "ADMIN" || role === "MANAGER");

  const draftRows = drafts.map((d) => ({ id: d.id, body: d.body, reason: d.reason, programme: d.programme, expiry: expiresInLabel(d.expiresAt, now), client: d.client }));
  const sentRows = sent.map((s) => ({ id: s.id, clientName: s.client.name, clientCode: s.client.clientCode, programme: s.programme, body: s.body, edited: s.body !== s.originalBody, by: s.decidedBy?.name ?? null, at: when(s.decidedAt ?? s.createdAt) }));
  const agentRows = AGENT_CATALOGUE.map((a) => {
    const st = agentStatus(a.key, process.env, settings.find((s) => s.agentKey === a.key) ?? null);
    return { key: a.key, label: a.label, blurb: a.blurb, envFlag: envFlagFor(a.key) ?? "", envOn: st.envOn, rowOn: st.rowOn };
  });

  return (
    <TabbedWorkspace
      idPrefix="agents"
      label="Agent sections"
      tabs={[
        { key: "drafts", label: "Drafts to review", count: draftRows.length },
        { key: "sent", label: "Sent" },
        { key: "rules", label: "Rules and kill switch" },
      ]}
      lazy
      panels={lazyPanels(AGENT_TAB_KEYS, rawTab, "drafts", {
        drafts: () => <DraftsReview drafts={draftRows} canAct={canAct} />,
        sent: () => <SentList rows={sentRows} />,
        rules: () => <RulesPanel agents={agentRows} rules={ruleLines()} canSwitch={role === "ADMIN"} />,
      })}
      header={
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
      }
      rail={
        <StickyRail
          label="Agent activity"
          facts={
            <>
              <RailFact label="Waiting for review" index={0} tone={draftRows.length > 0 ? "warning" : "default"}>
                <CountUp value={draftRows.length} />
              </RailFact>
              <RailFact label="Sent, last 7 days" index={1}>
                <CountUp value={sentWeek} />
              </RailFact>
              <RailFact label="Rejected, last 7 days" index={2}>
                <CountUp value={rejectedWeek} />
              </RailFact>
            </>
          }
        />
      }
    />
  );
}

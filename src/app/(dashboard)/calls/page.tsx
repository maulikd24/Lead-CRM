import Link from "next/link";
import { Info } from "lucide-react";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { isAnthropicConfigured } from "@/lib/ai/client";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { CallFilterToolbar } from "@/components/calls/call-filter-toolbar";
import { CallList } from "@/components/calls/call-list";
import { RollupPanel } from "@/components/calls/rollup-panel";
import { CountUp, RailFact, StickyRail, WorkspacePanel, WorkspaceShell, WorkspaceTabs, tabHref } from "@/components/workspace";
import { callsReviewEnabled } from "@/lib/calls/flag";
import { CALL_WINDOW_DAYS, loadCallRows, rmOptions } from "@/lib/calls/queries";
import { listStats, listTabs, parseListTab } from "@/lib/calls/tabs";
import { analysisNotice, applyFilters, buildRollup, parseFilters } from "@/lib/calls/view-model";

const PAGE_SIZE = 100;

export default async function CallsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!callsReviewEnabled()) notFound();
  const session = await requireRole(["ADMIN", "MANAGER", "RM"]);
  const isManager = session.user.role === "ADMIN" || session.user.role === "MANAGER";

  const now = new Date();
  const scope = await getVisibleUserIds(session.user.id, session.user.role);
  const all = await loadCallRows(scope, now);
  const params = await searchParams;
  const filters = parseFilters(params);
  const rows = applyFilters(all, filters);
  const shown = rows.slice(0, PAGE_SIZE);
  const notice = analysisNotice({ aiConfigured: isAnthropicConfigured(), scored: all.filter((r) => r.score !== null).length, total: all.length });
  const access = { isManager, hasCalls: all.length > 0 };
  const tab = parseListTab(params.tab, access);
  const stats = listStats(rows);
  const rollup = isManager && all.length > 0 ? buildRollup(rows) : null;

  const exotel = all.length === 0 ? await prisma.integrationConfig.findUnique({ where: { provider: "exotel" }, select: { isEnabled: true, mode: true } }) : null;
  const telephonyConnected = exotel?.isEnabled === true && exotel.mode === "live";

  // Tab links keep the filters, so changing section never loses them.
  const search = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (k === "tab" || v === undefined ? [] : Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]]))).toString();
  const tabs = listTabs(access).map((t) => ({ ...t, href: tabHref("/calls", search ? `?${search}` : "", t.key, { fallback: "calls" }), count: t.key === "calls" ? rows.length : null }));

  return (
    <WorkspaceShell
      header={
        <>
          <PageHeader
            title="Call recordings"
            description={isManager ? `Listen back, read the transcript and review how your team's calls went. Last ${CALL_WINDOW_DAYS} days.` : `Your own calls from the last ${CALL_WINDOW_DAYS} days, with how each one was scored.`}
          />
          {notice && (
            <p role="status" className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
              {notice}
            </p>
          )}
        </>
      }
      tabs={<WorkspaceTabs tabs={tabs} active={tab} idPrefix="calls" label="Call sections" />}
      toolbar={all.length > 0 ? <CallFilterToolbar filters={filters} rms={rmOptions(all)} showRm={isManager} tab={tab === "calls" ? undefined : tab} /> : undefined}
      rail={
        all.length > 0 ? (
          <StickyRail
            label="Calls in view"
            facts={
              <>
                <RailFact label="Calls in view" index={0}>
                  <CountUp value={stats.total} />
                </RailFact>
                <RailFact label="Average score" index={1}>
                  <CountUp value={stats.averageScore} />
                </RailFact>
                <RailFact label="Flagged" tone={stats.flagged > 0 ? "warning" : "default"} index={2}>
                  <CountUp value={stats.flagged} />
                </RailFact>
                <RailFact label="Reviewed" hint={`of ${stats.total}`} index={3}>
                  <CountUp value={stats.reviewed} />
                </RailFact>
              </>
            }
          />
        ) : undefined
      }
    >
      <WorkspacePanel tab={tab} idPrefix="calls">
        {tab === "rollup" && rollup ? (
          <RollupPanel rollup={rollup} />
        ) : (
          <>
            <Card className="py-0">
              <CardContent className="p-0">
                {all.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
                    <p className="font-heading text-sm font-medium">{telephonyConnected ? "No calls to review yet" : "Calls are not coming in yet"}</p>
                    <p className="max-w-md text-sm text-muted-foreground">
                      {telephonyConnected
                        ? "Calls appear here after the telephony provider sends them, or once the Android app syncs a customer's call."
                        : "Connect the telephony provider, or install the Android app so RMs' customer calls sync, and they will show up here with recordings and scores."}
                    </p>
                    {session.user.role === "ADMIN" && !telephonyConnected && (
                      <Link href="/settings/integrations" className="text-sm text-primary underline-offset-2 hover:underline">
                        Open Apps &amp; Integrations
                      </Link>
                    )}
                  </div>
                ) : (
                  <CallList rows={shown} showRm={isManager} hasAnyCalls />
                )}
              </CardContent>
            </Card>
            {rows.length > PAGE_SIZE && <p className="text-center text-xs text-muted-foreground">Showing the latest {PAGE_SIZE} of {rows.length} calls. Narrow the date range to see older ones.</p>}
          </>
        )}
      </WorkspacePanel>
    </WorkspaceShell>
  );
}

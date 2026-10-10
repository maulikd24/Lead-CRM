import Link from "next/link";
import { Info } from "lucide-react";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { isAnthropicConfigured } from "@/lib/ai/client";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { CallFiltersForm } from "@/components/calls/call-filters";
import { CallList } from "@/components/calls/call-list";
import { RollupPanel } from "@/components/calls/rollup-panel";
import { callsReviewEnabled } from "@/lib/calls/flag";
import { CALL_WINDOW_DAYS, loadCallRows, rmOptions } from "@/lib/calls/queries";
import { analysisNotice, applyFilters, buildRollup, parseFilters } from "@/lib/calls/view-model";

const PAGE_SIZE = 100;

export default async function CallsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!callsReviewEnabled()) notFound();
  const session = await requireRole(["ADMIN", "MANAGER", "RM"]);
  const isManager = session.user.role === "ADMIN" || session.user.role === "MANAGER";

  const now = new Date();
  const scope = await getVisibleUserIds(session.user.id, session.user.role);
  const all = await loadCallRows(scope, now);
  const filters = parseFilters(await searchParams);
  const rows = applyFilters(all, filters);
  const shown = rows.slice(0, PAGE_SIZE);
  const notice = analysisNotice({ aiConfigured: isAnthropicConfigured(), scored: all.filter((r) => r.score !== null).length, total: all.length });
  const rollup = isManager ? buildRollup(rows) : null;

  const exotel = all.length === 0 ? await prisma.integrationConfig.findUnique({ where: { provider: "exotel" }, select: { isEnabled: true, mode: true } }) : null;
  const telephonyConnected = exotel?.isEnabled === true && exotel.mode === "live";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Call recordings"
        description={isManager ? `Listen back, read the transcript and review how your team's calls went. Last ${CALL_WINDOW_DAYS} days.` : `Your own calls from the last ${CALL_WINDOW_DAYS} days, with how each one was scored.`}
      />

      {notice && (
        <p role="status" className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          {notice}
        </p>
      )}

      {all.length > 0 && <CallFiltersForm filters={filters} rms={rmOptions(all)} showRm={isManager} />}

      {rollup && all.length > 0 && <RollupPanel rollup={rollup} />}

      <Card>
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
    </div>
  );
}

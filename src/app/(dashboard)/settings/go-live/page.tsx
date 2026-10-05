import Link from "next/link";
import { Download } from "lucide-react";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { AREAS, GO_LIVE_ITEMS, type GoLiveItem, type Priority } from "@/lib/go-live/items";
import { runAutoChecks, type CheckResult } from "@/lib/go-live/checks";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils/format";
import { ManualItemControl } from "./manual-item-control";

const PRIORITY_VARIANT: Record<Priority, "destructive" | "warning" | "outline"> = { BLOCKER: "destructive", SHOULD: "warning", NICE: "outline" };
const PRIORITY_LABEL: Record<Priority, string> = { BLOCKER: "Blocker", SHOULD: "Should have", NICE: "Nice to have" };
const STATUS_VARIANT = { pass: "success", warn: "warning", fail: "destructive" } as const;
const STATUS_LABEL = { pass: "Ready", warn: "Check", fail: "Not ready" } as const;

type Tick = { done: boolean; note: string | null; doneAt: Date | null; doneByName: string | null };

function isReady(item: GoLiveItem, auto: Record<string, CheckResult>, ticks: Map<string, Tick>): boolean {
  return item.kind === "auto" ? auto[item.id]?.status === "pass" : !!ticks.get(item.id)?.done;
}

export default async function GoLivePage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireRole(["ADMIN"]);
  const { show } = await searchParams;
  const filter = show === "open" || show === "blockers" ? show : "all";

  const [auto, tickRows] = await Promise.all([runAutoChecks(), prisma.goLiveCheck.findMany()]);
  const users = await prisma.user.findMany({ where: { id: { in: tickRows.map((t) => t.doneById).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const ticks = new Map<string, Tick>(tickRows.map((t) => [t.itemId, { done: t.done, note: t.note, doneAt: t.doneAt, doneByName: t.doneById ? (nameById.get(t.doneById) ?? null) : null }]));

  const blockers = GO_LIVE_ITEMS.filter((i) => i.priority === "BLOCKER");
  const blockersReady = blockers.filter((i) => isReady(i, auto, ticks)).length;
  const allReady = GO_LIVE_ITEMS.filter((i) => isReady(i, auto, ticks)).length;
  const autoFail = GO_LIVE_ITEMS.filter((i) => i.kind === "auto" && auto[i.id]?.status === "fail").length;

  const visible = (item: GoLiveItem) => (filter === "open" ? !isReady(item, auto, ticks) : filter === "blockers" ? item.priority === "BLOCKER" && !isReady(item, auto, ticks) : true);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Go-Live Checklist"
        description="Everything to verify before launch. Items marked Automatic are checked live from the running system; the rest are ticked by a person once confirmed."
        actions={
          <Button variant="outline" size="sm" render={<a href="/api/go-live/export" />}>
            <Download className="size-4" /> Download CSV
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card size="sm">
          <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Blockers ready</CardTitle></CardHeader>
          <CardContent>
            <p className="font-heading text-3xl font-semibold tabular-nums">{blockersReady}<span className="text-lg text-muted-foreground"> / {blockers.length}</span></p>
            <p className="text-xs text-muted-foreground">{blockers.length - blockersReady === 0 ? "Every blocker is green." : `${blockers.length - blockersReady} still open before you can launch.`}</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">All items ready</CardTitle></CardHeader>
          <CardContent>
            <p className="font-heading text-3xl font-semibold tabular-nums">{allReady}<span className="text-lg text-muted-foreground"> / {GO_LIVE_ITEMS.length}</span></p>
            <p className="text-xs text-muted-foreground">Includes should-have and nice-to-have items.</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Automatic checks failing</CardTitle></CardHeader>
          <CardContent>
            <p className={`font-heading text-3xl font-semibold tabular-nums ${autoFail > 0 ? "text-destructive" : "text-success"}`}>{autoFail}</p>
            <p className="text-xs text-muted-foreground">{auto["cron-heartbeat"]?.message}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Show:</span>
        {[["all", "Everything"], ["open", "Not ready yet"], ["blockers", "Open blockers only"]].map(([value, label]) => (
          <Link key={value} href={value === "all" ? "/settings/go-live" : `/settings/go-live?show=${value}`} className={`rounded-md border px-2.5 py-1 text-xs ${filter === value ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
            {label}
          </Link>
        ))}
      </div>

      {AREAS.map((area) => {
        const items = GO_LIVE_ITEMS.filter((i) => i.area === area);
        const shown = items.filter(visible);
        const ready = items.filter((i) => isReady(i, auto, ticks)).length;
        if (shown.length === 0) return null;
        return (
          <Card key={area}>
            <CardHeader>
              <CardTitle className="text-base">{area}</CardTitle>
              <CardDescription>{ready} of {items.length} ready</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col divide-y">
              {shown.map((item) => {
                const result = auto[item.id];
                const tick = ticks.get(item.id);
                return (
                  <div key={item.id} className="grid grid-cols-1 gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[1fr_16rem]">
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{item.title}</p>
                        <Badge variant={PRIORITY_VARIANT[item.priority]}>{PRIORITY_LABEL[item.priority]}</Badge>
                        <Badge variant="outline">{item.kind === "auto" ? "Automatic" : "Manual"}</Badge>
                        <span className="text-xs text-muted-foreground">Owner: {item.owner}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{item.detail}</p>
                    </div>
                    {item.kind === "auto" ? (
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant={STATUS_VARIANT[result?.status ?? "fail"]}>{STATUS_LABEL[result?.status ?? "fail"]}</Badge>
                        <p className="text-xs text-muted-foreground">{result?.message ?? "No result."}</p>
                      </div>
                    ) : (
                      <ManualItemControl
                        itemId={item.id}
                        title={item.title}
                        done={!!tick?.done}
                        note={tick?.note ?? ""}
                        doneLabel={tick?.done && tick.doneAt ? `Verified by ${tick.doneByName ?? "an Admin"} · ${formatDateTime(tick.doneAt)}` : null}
                      />
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

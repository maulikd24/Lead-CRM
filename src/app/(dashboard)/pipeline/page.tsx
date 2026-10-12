import Link from "next/link";

import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { prisma } from "@/lib/db/prisma";
import { getPipelineBoard, COMPLETED_WINDOW_DAYS } from "@/lib/pipeline/board";
import { BOARD_FILTERS, parseBoardFilter } from "@/lib/pipeline/board-logic";
import { formatInrCompact } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { PipelineBoard } from "./pipeline-board";
import { RmFilter } from "./rm-filter";

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ filter?: string; rm?: string }> }) {
  const params = await searchParams;
  const session = await requireRole(["ADMIN", "MANAGER", "RM"]);
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);
  const filter = parseBoardFilter(params.filter);
  const canPickRm = session.user.role !== "RM";
  const rm = canPickRm ? params.rm : undefined;

  const [columns, rms] = await Promise.all([
    getPipelineBoard({ userId: session.user.id, role: session.user.role, visibleUserIds, filter, rm }),
    canPickRm
      ? prisma.user.findMany({
          where: { isActive: true, role: "RM", ...(visibleUserIds ? { id: { in: visibleUserIds } } : {}) },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const open = columns.slice(0, -1);
  const openCount = open.reduce((sum, c) => sum + c.count, 0);
  const openValue = open.reduce((sum, c) => sum + c.totalExpected, 0);
  const hrefFor = (key: string) => {
    const usp = new URLSearchParams();
    if (key !== "all") usp.set("filter", key);
    if (rm) usp.set("rm", rm);
    const qs = usp.toString();
    return qs ? `/pipeline?${qs}` : "/pipeline";
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Pipeline"
        description={`${openCount} client${openCount === 1 ? "" : "s"} onboarding · ${formatInrCompact(openValue)} expected. Drag a card to the next stage, or use its Next stage button.`}
        actions={
          <Button size="sm" variant="outline" render={<Link href="/clients" />}>
            List view
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Board filter" className="flex w-fit items-center gap-1 rounded-md border border-border p-0.5">
          {BOARD_FILTERS.map((f) => (
            <Link
              key={f.key}
              href={hrefFor(f.key)}
              aria-current={filter === f.key ? "page" : undefined}
              className={cn(
                "rounded px-3 py-1.5 text-xs font-semibold transition-colors",
                filter === f.key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </Link>
          ))}
        </nav>
        {canPickRm && <RmFilter rms={rms} value={rm ?? ""} />}
      </div>
      <PipelineBoard columns={columns} role={session.user.role} completedWindowDays={COMPLETED_WINDOW_DAYS} />
    </div>
  );
}

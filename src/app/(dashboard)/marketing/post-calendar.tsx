import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PostView } from "@/lib/marketing/social/queries";
import { monthGrid, toLocalInputValue } from "@/lib/marketing/zoned-time";
import { cn } from "@/lib/utils";
import { workspaceHref } from "@/lib/marketing/workspace-params";

import { channelLabel, PostCard } from "./post-board";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Month calendar of SCHEDULED posts (the day each is intended to go out), with every other post listed below to be scheduled. */
export function PostCalendar({ posts, month, today, timezone, hrefFor }: { posts: PostView[]; month: string; today: string; timezone: string; hrefFor: (id: string) => string }) {
  const grid = monthGrid(month, today);
  const byDay = new Map<string, PostView[]>();
  for (const p of posts) {
    if (p.status !== "SCHEDULED" || !p.scheduledFor) continue;
    const day = toLocalInputValue(new Date(p.scheduledFor), timezone).slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), p]);
  }
  const unscheduled = posts.filter((p) => p.status !== "SCHEDULED");
  const nav = (m: string) => workspaceHref({ tab: "posts", view: "calendar", month: m });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-heading text-base font-semibold">{grid.label}</h3>
        <div className="flex gap-1">
          <Button size="icon-sm" variant="outline" aria-label="Previous month" render={<Link href={nav(grid.prev)} scroll={false} />}><ChevronLeft /></Button>
          <Button size="sm" variant="outline" render={<Link href={nav(today.slice(0, 7))} scroll={false} />}>Today</Button>
          <Button size="icon-sm" variant="outline" aria-label="Next month" render={<Link href={nav(grid.next)} scroll={false} />}><ChevronRight /></Button>
        </div>
      </div>
      <div role="grid" aria-label={`Scheduled posts, ${grid.label}`} className="overflow-x-auto">
        <div className="grid min-w-[34rem] grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border text-xs">
          {DAYS.map((d) => <div key={d} role="columnheader" className="bg-muted px-2 py-1.5 font-medium text-muted-foreground">{d}</div>)}
          {grid.weeks.flat().map((day) => {
            const items = byDay.get(day.date) ?? [];
            return (
              <div key={day.date} role="gridcell" className={cn("min-h-20 bg-card p-1.5", !day.inMonth && "bg-muted/40 text-muted-foreground")}>
                <p className={cn("mb-1 tabular-nums", day.date === today && "inline-flex size-5 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground")}>{Number(day.date.slice(8))}</p>
                <div className="flex flex-col gap-1">
                  {items.slice(0, 3).map((p) => (
                    <Link key={p.id} href={hrefFor(p.id)} scroll={false} className="truncate rounded bg-chart-2/15 px-1.5 py-0.5 text-[0.7rem] font-medium text-foreground outline-none hover:bg-chart-2/30 focus-visible:ring-2 focus-visible:ring-ring" title={p.title ?? p.body.slice(0, 80)}>
                      {`${channelLabel(p.channel)}: ${p.title?.trim() || p.body.split("\n")[0]}`}
                    </Link>
                  ))}
                  {items.length > 3 && <span className="px-1 text-[0.7rem] text-muted-foreground">{`+${items.length - 3} more`}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {unscheduled.length > 0 && (
        <section aria-label="Posts still to schedule">
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">Still to get to Scheduled</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {unscheduled.slice(0, 6).map((p) => <PostCard key={p.id} post={p} href={hrefFor(p.id)} timezone={timezone} />)}
          </div>
        </section>
      )}
    </div>
  );
}

import { Inbox as InboxIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { MasterDetail, type MasterItem } from "@/components/workspace";
import type { InboxItem } from "@/lib/policy/approvals/canonical/service";
import { cn } from "@/lib/utils";

import { DecisionPanel } from "./decision-panel";
import { STATE_CHIP, detailOf, rowOf, type InboxTab, type kindChips as KindChips } from "./view-model";

type Chip = ReturnType<typeof KindChips>[number];

/** Filter chips: real links, so the filter is in the URL and works without scripts. */
export function KindFilter({ chips }: { chips: Chip[] }) {
  if (chips.length <= 2) return null; // "All" plus a single kind needs no filter
  return (
    <nav aria-label="Filter by kind" className="flex shrink-0 gap-1.5 overflow-x-auto px-0.5 py-1">
      {chips.map((c) => (
        <Link
          key={c.key}
          href={c.href}
          scroll={false}
          aria-current={c.active ? "true" : undefined}
          className={cn("inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors", c.active ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
        >
          {c.label}
          <span className="tabular-nums text-muted-foreground">{c.count}</span>
        </Link>
      ))}
    </nav>
  );
}

const EMPTY: Record<InboxTab, { title: string; description: string }> = {
  awaiting: { title: "You are all caught up", description: "Nothing is waiting for your decision. New requests appear here as they come in." },
  mine: { title: "You have not asked for anything yet", description: "Requests you make that need someone else's approval show up here, with where they stand." },
};

/** The list and the detail. Server-rendered rows; each detail is the client DecisionPanel for that item. */
export function Inbox({ items, tab, now, filtered }: { items: InboxItem[]; tab: InboxTab; now: Date; filtered: boolean }) {
  if (items.length === 0) {
    const e = filtered ? { title: "Nothing of this kind", description: "Clear the filter to see everything waiting for you." } : EMPTY[tab];
    return <EmptyState icon={InboxIcon} title={e.title} description={e.description} action={filtered ? { label: "Show all", href: tab === "mine" ? "/approvals?tab=mine" : "/approvals" } : undefined} />;
  }
  const rows: MasterItem[] = items.map((i) => ({
    ...rowOf(i, now),
    trailing: tab === "mine" || i.state !== "requested" ? <Badge variant={STATE_CHIP[i.state].variant} className={STATE_CHIP[i.state].variant === "success" ? "bg-transparent dark:bg-transparent" : undefined}>{STATE_CHIP[i.state].label}</Badge> : undefined,
  }));
  const details = Object.fromEntries(items.map((i) => [i.ref, <DecisionPanel key={i.ref} d={detailOf(i, now, tab === "mine")} />]));
  return <MasterDetail idPrefix="appr" label="Approvals" noun="approvals" items={rows} details={details} />;
}

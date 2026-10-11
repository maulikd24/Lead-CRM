import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { MasterDetail, Skeleton, type MasterItem } from "@/components/workspace";
import { OVERRIDE_LABEL } from "@/lib/attention/constants";
import type { AttentionItem } from "@/lib/attention/engine";
import type { FeedView } from "@/lib/attention/feed";
import { cn } from "@/lib/utils";
import { AttentionControls, type AttentionAct } from "./attention-controls";

const when = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

function Why({ item }: { item: AttentionItem }) {
  return (
    <section aria-label="Why this is here" className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Why this is here</h3>
      {item.why.override && <p className="rounded-lg border border-border px-3 py-2 text-sm"><span className="font-medium">{item.why.override.label}.</span> It sits above everything that only has a score.</p>}
      <div className="overflow-x-auto" role="region" aria-label="How the score was made" tabIndex={0}>
        <table className="w-full min-w-[20rem] text-left text-sm">
          <caption className="sr-only">How the score was made</caption>
          <thead className="text-xs text-muted-foreground"><tr><th scope="col" className="py-1 pr-3 font-medium">Input</th><th scope="col" className="py-1 pr-3 font-medium">Reading</th><th scope="col" className="py-1 text-right font-medium">Factor</th></tr></thead>
          <tbody>
            {item.why.factors.map((f) => (
              <tr key={f.key} className="border-t border-border">
                <th scope="row" className="py-1 pr-3 font-normal">{f.label}</th>
                <td className="py-1 pr-3 text-muted-foreground">{f.input}</td>
                <td className="py-1 text-right tabular-nums">{Math.round(f.value * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Score {item.score} out of 100 = {item.why.formula}. {item.why.label} ({item.why.version}). Rules, not AI.</p>
    </section>
  );
}

function Detail({ item, owner, act }: { item: AttentionItem; owner: string | null; act: AttentionAct }) {
  const hard = item.override !== "none";
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={hard ? "destructive" : "secondary"}>{hard ? OVERRIDE_LABEL[item.override] : item.kindLabel}</Badge>
          {item.lane === "later" && <Badge variant="outline">Later: queue is full today</Badge>}
        </div>
        <h2 className="font-heading text-lg font-semibold leading-tight">{item.title}</h2>
        {item.detail && <p className="text-sm text-muted-foreground">{item.detail}</p>}
        <p className="text-xs text-muted-foreground">{item.subject.label}{owner ? ` · ${owner}` : ""} · since {when(item.occurredAt)}</p>
      </div>
      <div><Link href={item.href} className={cn(buttonVariants({ size: "sm" }))}>Open</Link></div>
      <Why item={item} />
      <section aria-label="Snooze or dismiss" className="flex flex-col gap-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Not now</h3>
        <AttentionControls itemId={item.id} hard={hard} act={act} />
      </section>
    </div>
  );
}

/**
 * The Needs attention feed: a ranked list on the left, the selected item's why and actions on the right (one panel, no page scroll on a
 * laptop; a list with a detail sheet on a phone). It only reads and ranks: nothing here sends a message.
 */
export function NeedsAttentionFeed({ feed, showOwner, act, emptyTitle = "Nothing needs your attention right now." }: { feed: FeedView; showOwner: boolean; act: AttentionAct; emptyTitle?: string }) {
  const ordered = [...feed.items.filter((i) => i.lane === "now"), ...feed.items.filter((i) => i.lane === "later")];
  const nowCount = feed.items.filter((i) => i.lane === "now").length;
  const laterCount = feed.items.length - nowCount;
  const ownerOf = (i: AttentionItem) => (i.ownerUserId ? feed.ownerNames[i.ownerUserId] ?? null : null);
  const items: MasterItem[] = ordered.map((i) => ({
    id: i.id,
    title: i.title,
    meta: [i.kindLabel, showOwner ? ownerOf(i) : null, i.lane === "later" ? "Later" : null].filter(Boolean).join(" · "),
    trailing: i.override !== "none" ? <Badge variant="destructive">{OVERRIDE_LABEL[i.override]}</Badge> : <Badge variant="secondary">{i.score}</Badge>,
  }));
  const details = Object.fromEntries(ordered.map((i) => [i.id, <Detail key={i.id} item={i} owner={showOwner ? ownerOf(i) : null} act={act} />]));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1 basis-44">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Ranked by rules, not AI</p>
          <h2 className="font-heading text-lg font-semibold leading-tight">Needs attention</h2>
          <p className="text-xs text-muted-foreground max-lg:hidden">{feed.label}. Complaints, compliance and critical incidents always come first.</p>
        </div>
        <dl className="flex shrink-0 gap-x-6">
          <div><dt className="text-xs text-muted-foreground">Now</dt><dd className="font-heading text-lg font-semibold tabular-nums">{nowCount}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Later</dt><dd className="font-heading text-lg font-semibold tabular-nums">{laterCount}</dd></div>
          {feed.hiddenByDismissal > 0 && <div><dt className="text-xs text-muted-foreground">Hidden by you</dt><dd className="font-heading text-lg font-semibold tabular-nums">{feed.hiddenByDismissal}</dd></div>}
        </dl>
      </div>
      {feed.teamLoad.length > 0 && (
        <p role="status" className="rounded-lg border border-border px-3 py-2 text-sm">
          Heavy workload: {feed.teamLoad.slice(0, 3).map((t) => `${t.name} (${t.openWorkload} open tasks${t.deferred ? `, ${t.deferred} pushed to later` : ""})`).join("; ")}{feed.teamLoad.length > 3 ? ` and ${feed.teamLoad.length - 3} more` : ""}.
        </p>
      )}
      {feed.sourceErrors.length > 0 && <p role="status" className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">Some sources could not be read ({feed.sourceErrors.join(", ")}). The rest is shown.</p>}
      {items.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl border border-border px-3 py-6 text-sm text-muted-foreground"><CheckCircle2 className="size-4 text-success" aria-hidden />{emptyTitle}</p>
      ) : (
        <MasterDetail idPrefix="attn" label="Needs attention" noun="items" items={items} details={details} />
      )}
    </div>
  );
}

export function NeedsAttentionSkeleton() {
  return <Skeleton className="h-64" />;
}

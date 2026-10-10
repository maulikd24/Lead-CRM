import Link from "next/link";
import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { SOCIAL_CHANNELS, isSocialChannel } from "@/lib/marketing/social/compliance";
import type { PostView } from "@/lib/marketing/social/queries";
import { POST_STATUSES, STATUS_LABEL, type PostStatus } from "@/lib/marketing/social/workflow";
import { formatInZone } from "@/lib/marketing/zoned-time";
import { cn } from "@/lib/utils";

import styles from "./marketing.module.css";

const DOT: Record<PostStatus, string> = { DRAFT: "bg-muted-foreground", NEEDS_REVIEW: "bg-warning", APPROVED: "bg-success", SCHEDULED: "bg-chart-2" };

export const channelLabel = (channel: string) => (isSocialChannel(channel) ? SOCIAL_CHANNELS[channel].label : channel);

export function PostCard({ post, href, timezone, selected }: { post: PostView; href: string; timezone: string; selected?: boolean }) {
  const text = post.title?.trim() || post.body.split("\n")[0];
  return (
    <Link href={href} scroll={false} aria-current={selected ? "true" : undefined} className={cn(styles.lift, "block rounded-lg border bg-card p-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50", selected && "border-primary")}>
      <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span aria-hidden className={cn("size-2 rounded-full", DOT[post.status])} />{channelLabel(post.channel)}</span>
        <span className="flex items-center gap-1">
          {post.source === "AI" && <Badge variant="accent"><Sparkles aria-hidden />AI</Badge>}
          {post.issues.length > 0 && <Badge variant="warning">{`${post.issues.length} to fix`}</Badge>}
        </span>
      </span>
      <span className="mt-1.5 line-clamp-3 text-sm font-medium">{text}</span>
      {post.scheduledFor && <span className="mt-1.5 block text-xs text-muted-foreground">{`For ${formatInZone(new Date(post.scheduledFor), timezone)}`}</span>}
    </Link>
  );
}

/** Four columns, one per status. On a phone the columns scroll sideways as a snap list so one status is on screen at a time. */
export function PostBoard({ posts, hrefFor, selectedId, timezone }: { posts: PostView[]; hrefFor: (id: string) => string; selectedId?: string; timezone: string }) {
  return (
    <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-2 md:overflow-visible xl:grid-cols-4">
      {POST_STATUSES.map((status) => {
        const column = posts.filter((p) => p.status === status);
        return (
          <section key={status} aria-label={`${STATUS_LABEL[status]} posts`} className="min-w-[78%] shrink-0 snap-start sm:min-w-[45%] md:min-w-0">
            <h3 className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
              <span className="flex items-center gap-1.5"><span aria-hidden className={cn("size-2 rounded-full", DOT[status])} />{STATUS_LABEL[status]}</span>
              <span className="tabular-nums">{column.length}</span>
            </h3>
            <div className="flex flex-col gap-2">
              {column.length === 0 ? <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">Nothing here.</p> : column.map((p) => <PostCard key={p.id} post={p} href={hrefFor(p.id)} timezone={timezone} selected={p.id === selectedId} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

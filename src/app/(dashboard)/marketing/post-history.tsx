import type { PostEventView } from "@/lib/marketing/social/queries";
import { STATUS_LABEL, POST_STATUSES, type PostStatus } from "@/lib/marketing/social/workflow";
import { cn } from "@/lib/utils";

const ACTION: Record<string, string> = { create: "Created", edit: "Edited", submit: "Sent for review", approve: "Approved", request_changes: "Changes requested", schedule: "Scheduled", unschedule: "Unscheduled" };

/** Where the post is on Draft > Needs review > Approved > Scheduled. */
export function StatusSteps({ status }: { status: PostStatus }) {
  const at = POST_STATUSES.indexOf(status);
  return (
    <ol aria-label="Post status" className="flex items-center gap-1">
      {POST_STATUSES.map((s, i) => (
        <li key={s} aria-current={i === at ? "step" : undefined} className="flex flex-1 flex-col gap-1">
          <span className={cn("h-1.5 rounded-full", i <= at ? "bg-primary" : "bg-muted")} />
          <span className={cn("text-[0.7rem] leading-tight", i === at ? "font-medium text-foreground" : "text-muted-foreground")}>{STATUS_LABEL[s]}</span>
        </li>
      ))}
    </ol>
  );
}

export function PostHistory({ events, timezone }: { events: PostEventView[]; timezone: string }) {
  const fmt = new Intl.DateTimeFormat("en-IN", { timeZone: timezone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return (
    <ol className="flex flex-col gap-2 text-xs">
      {[...events].reverse().map((e, i) => (
        <li key={i} className="flex flex-col">
          <span className="font-medium">{ACTION[e.action] ?? e.action}{e.actorName ? ` by ${e.actorName}` : ""}</span>
          <span className="text-muted-foreground">{fmt.format(new Date(e.at))}{e.to ? ` · ${STATUS_LABEL[e.to as PostStatus] ?? e.to}` : ""}</span>
          {e.note && <span className="text-muted-foreground">{e.note}</span>}
        </li>
      ))}
    </ol>
  );
}

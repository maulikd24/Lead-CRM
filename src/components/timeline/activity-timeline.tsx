"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  StickyNote,
  ArrowRightLeft,
  GitBranch,
  Phone,
  Ticket,
  MessageSquare,
  CheckCircle2,
  Workflow,
  CalendarCheck,
  UserCheck,
  Trash2,
} from "lucide-react";

import Link from "next/link";

import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Badge, type badgeVariants } from "@/components/ui/badge";
import { addClientNoteAction, deleteActivityNoteAction } from "@/app/(dashboard)/clients/actions";
import { formatDateTime } from "@/lib/utils/format";
import type { VariantProps } from "class-variance-authority";
import type { Activity, ActivityType, Role } from "@/generated/prisma/client";
import type { SafeUser } from "@/lib/db/safe-user";

const SENTIMENT_VARIANT: Record<string, NonNullable<VariantProps<typeof badgeVariants>["variant"]>> = {
  positive: "success",
  neutral: "outline",
  mixed: "warning",
  negative: "destructive",
};

const ICONS: Record<ActivityType, React.ComponentType<{ className?: string }>> = {
  NOTE: StickyNote,
  STATUS_CHANGE: ArrowRightLeft,
  STAGE_CHANGE: GitBranch,
  CALL: Phone,
  TICKET: Ticket,
  MESSAGE: MessageSquare,
  TASK_COMPLETED: CheckCircle2,
  JOURNEY_EVENT: Workflow,
  MEETING: CalendarCheck,
  CONTACT: UserCheck,
};

// The three types an RM can deliberately log from the Add Note form — feeds the Daily RM Report's
// "clients contacted"/"meetings completed" counts, which need an intentional signal distinct from
// a generic note.
const LOGGABLE_TYPES: { value: ActivityType; label: string }[] = [
  { value: "NOTE", label: "Note" },
  { value: "CONTACT", label: "Contacted client" },
  { value: "MEETING", label: "Meeting completed" },
];

export type ActivityWithUser = Activity & { user: SafeUser | null };

function describeActivity(activity: ActivityWithUser): string {
  const payload = activity.payload as Record<string, unknown> | null;
  const message = typeof payload?.message === "string" ? payload.message : null;
  if (message) return message;

  switch (activity.type) {
    case "STATUS_CHANGE":
      return `Status changed to ${payload?.status ?? "unknown"}`;
    case "STAGE_CHANGE":
      return `Stage changed from ${payload?.fromStage ?? "?"} to ${payload?.toStage ?? "?"}`;
    case "MESSAGE": {
      const direction = payload?.direction === "INBOUND" ? "Received" : "Sent";
      const channel = typeof payload?.channel === "string" ? payload.channel : "message";
      const body = typeof payload?.body === "string" ? payload.body : "";
      return `${direction} ${channel}: ${body}`;
    }
    case "CALL": {
      const status = typeof payload?.status === "string" ? payload.status : "completed";
      const duration = payload?.durationSeconds ? ` (${payload.durationSeconds}s)` : "";
      return `Call ${status}${duration}`;
    }
    case "TICKET": {
      // One entry per ticket, kept current by the Freshdesk webhooks/history sync (older rows lack subject).
      const ticketId = payload?.ticketId ?? payload?.eventType;
      return `Support ticket #${ticketId}${payload?.subject ? `: ${payload.subject}` : ""} — ${payload?.status ?? "updated"}`;
    }
    default:
      return activity.type.replace(/_/g, " ").toLowerCase();
  }
}

const CATEGORY_ORDER: ActivityType[] = [
  "NOTE",
  "CONTACT",
  "MEETING",
  "STATUS_CHANGE",
  "STAGE_CHANGE",
  "CALL",
  "MESSAGE",
  "TICKET",
  "TASK_COMPLETED",
  "JOURNEY_EVENT",
];

export function ActivityTimeline({
  activities,
  clientId,
  filterTypes,
  showAddNote = true,
  currentUserRole,
  qualityReviewsByActivityId,
}: {
  activities: ActivityWithUser[];
  clientId: string;
  filterTypes?: ActivityType[];
  showAddNote?: boolean;
  currentUserRole?: Role;
  /** Keyed by Activity.id (CALL rows only) — the quality-audit review for that call, if one exists. */
  qualityReviewsByActivityId?: Record<string, { id: string; sentimentLabel: string | null; qualityScore: number | null }>;
}) {
  const [pending, setPending] = useState(false);
  const [category, setCategory] = useState<ActivityType | "ALL">("ALL");
  const [noteType, setNoteType] = useState<ActivityType>("NOTE");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleRemove(activityId: string) {
    setRemovingId(activityId);
    try {
      await deleteActivityNoteAction(activityId);
      setConfirmRemoveId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove note");
    } finally {
      setRemovingId(null);
    }
  }

  async function handleSubmit(formData: FormData) {
    const note = String(formData.get("note") ?? "").trim();
    if (!note) return;
    setPending(true);
    try {
      await addClientNoteAction(clientId, note, noteType);
      formRef.current?.reset();
      setNoteType("NOTE");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add note");
    } finally {
      setPending(false);
    }
  }

  const visibleActivities = filterTypes
    ? activities.filter((a) => filterTypes.includes(a.type))
    : category === "ALL"
      ? activities
      : activities.filter((a) => a.type === category);

  const presentCategories = filterTypes
    ? []
    : CATEGORY_ORDER.filter((type) => activities.some((a) => a.type === type));

  return (
    <div className="flex flex-col gap-4">
      {showAddNote && (
        <form ref={formRef} action={handleSubmit} className="flex flex-col gap-2">
          <Textarea name="note" placeholder="Add a note..." rows={2} />
          <div className="flex items-center justify-between gap-2">
            <Select value={noteType} onValueChange={(v) => v && setNoteType(v as ActivityType)}>
              <SelectTrigger className="h-8 w-48 text-xs">
                <SelectValue>{(v: string) => LOGGABLE_TYPES.find((t) => t.value === v)?.label ?? "Note"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {LOGGABLE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Adding..." : "Add"}
            </Button>
          </div>
        </form>
      )}

      {presentCategories.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setCategory("ALL")}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              category === "ALL" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            All
          </button>
          {presentCategories.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setCategory(type)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                category === type ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {type.replace(/_/g, " ").toLowerCase()}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {visibleActivities.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">No activity yet.</p>
        )}
        {visibleActivities.map((activity) => {
          const Icon = ICONS[activity.type];
          return (
            <div key={activity.id} className="flex gap-3 border-b pb-3 last:border-0">
              <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                <Icon className="size-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm">{describeActivity(activity)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {activity.user?.name ?? "System"} · {formatDateTime(activity.createdAt)}
                  {activity.type === "CALL" && (activity.payload as Record<string, unknown> | null)?.source === "device" && (
                    <Badge variant="outline" className="ml-2 text-[10px]">
                      Logged from phone
                    </Badge>
                  )}
                </p>
                {activity.type === "CALL" && qualityReviewsByActivityId?.[activity.id]?.qualityScore !== null && qualityReviewsByActivityId?.[activity.id] && (
                  <Link href={`/quality-audit/${qualityReviewsByActivityId[activity.id].id}`} className="mt-1 inline-flex items-center gap-1.5">
                    {qualityReviewsByActivityId[activity.id].sentimentLabel && (
                      <Badge variant={SENTIMENT_VARIANT[qualityReviewsByActivityId[activity.id].sentimentLabel!] ?? "outline"} className="text-[10px]">
                        {qualityReviewsByActivityId[activity.id].sentimentLabel}
                      </Badge>
                    )}
                    <span className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline">
                      Quality: {qualityReviewsByActivityId[activity.id].qualityScore}/100
                    </span>
                  </Link>
                )}
              </div>
              {currentUserRole === "ADMIN" && activity.type === "NOTE" && (
                <Dialog open={confirmRemoveId === activity.id} onOpenChange={(open) => setConfirmRemoveId(open ? activity.id : null)}>
                  <DialogTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                      />
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Remove this note?</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">This can&apos;t be undone.</p>
                    <DialogFooter>
                      <Button type="button" variant="destructive" disabled={removingId === activity.id} onClick={() => void handleRemove(activity.id)}>
                        {removingId === activity.id ? "Removing..." : "Remove"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

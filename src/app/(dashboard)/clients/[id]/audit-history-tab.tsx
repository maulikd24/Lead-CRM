import type { ComponentType } from "react";
import {
  GitBranch,
  GitMerge,
  CheckCircle2,
  PauseCircle,
  PlayCircle,
  XCircle,
  RotateCcw,
  ArrowRightLeft,
  UserX,
  PlusCircle,
  History,
} from "lucide-react";

import { formatDateTime } from "@/lib/utils/format";
import type { AuditLog, User } from "@/generated/prisma/client";

type AuditLogWithUser = AuditLog & { user: User };

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  created: PlusCircle,
  stage_changed: GitBranch,
  stage_corrected: GitBranch,
  auto_completed: CheckCircle2,
  hold_started: PauseCircle,
  hold_resolved: PlayCircle,
  marked_not_proceeding: XCircle,
  reopened: RotateCcw,
  auto_assign_failed: UserX,
  bulk_reassigned: ArrowRightLeft,
  auto_reassigned: ArrowRightLeft,
  merged: GitMerge,
};

function userName(id: unknown, usersById: Map<string, string>): string {
  if (typeof id !== "string") return "Unassigned";
  return usersById.get(id) ?? "Unassigned";
}

function describeAuditLog(log: AuditLogWithUser, usersById: Map<string, string>): string {
  const oldValue = log.oldValue as Record<string, unknown> | null;
  const newValue = log.newValue as Record<string, unknown> | null;

  switch (log.action) {
    case "created":
      return `Client created${newValue?.stage ? ` at stage ${newValue.stage}` : ""}`;
    case "stage_changed":
      return `Stage changed from ${oldValue?.stage ?? "?"} to ${newValue?.stage ?? "?"}`;
    case "stage_corrected":
      return `Stage corrected from ${oldValue?.stage ?? "?"} to ${newValue?.stage ?? "?"}`;
    case "auto_completed":
      return `Automatically marked ${newValue?.status ?? "Completed"}`;
    case "hold_started":
      return "Put on hold";
    case "hold_resolved":
      return "Hold resolved, back in progress";
    case "marked_not_proceeding":
      return "Marked as not proceeding";
    case "reopened":
      return "Reopened";
    case "auto_assign_failed":
      return oldValue?.assignedToId
        ? `${userName(oldValue.assignedToId, usersById)} unassigned — no eligible RM found`
        : "No eligible RM found for assignment";
    case "bulk_reassigned":
      return `Reassigned from ${userName(oldValue?.assignedToId, usersById)} to ${userName(newValue?.assignedToId, usersById)}`;
    case "auto_reassigned":
      return `Auto-reassigned from ${userName(oldValue?.assignedToId, usersById)} to ${userName(newValue?.assignedToId, usersById)}`;
    case "merged": {
      const conflicts = Array.isArray(newValue?.unresolvedConflicts) ? newValue.unresolvedConflicts.length : 0;
      return `Merged into another client record${conflicts ? ` (${conflicts} field${conflicts === 1 ? "" : "s"} need review)` : ""}`;
    }
    default:
      return log.action.replace(/_/g, " ");
  }
}

export function AuditHistoryTab({ logs, users }: { logs: AuditLogWithUser[]; users: User[] }) {
  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">No audit history.</p>;
  }

  const usersById = new Map(users.map((u) => [u.id, u.name]));

  return (
    <div className="relative flex flex-col gap-4">
      <div className="absolute left-3.5 top-4 bottom-4 w-px bg-border" aria-hidden />
      {logs.map((log) => {
        const Icon = ICONS[log.action] ?? History;
        return (
          <div key={log.id} className="relative flex gap-3">
            <div className="relative z-10 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
              <Icon className="size-3.5" />
            </div>
            <div className="flex-1 min-w-0 pb-0.5">
              <p className="text-sm">{describeAuditLog(log, usersById)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {log.user?.name ?? "System"} · {formatDateTime(log.timestamp)}
                {log.reason ? ` · ${log.reason}` : ""}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

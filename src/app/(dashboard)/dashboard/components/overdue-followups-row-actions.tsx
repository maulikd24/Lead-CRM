"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { rowReveal } from "@/components/wow/row";
import { cn } from "@/lib/utils";
import { completeTaskAction, updateTaskAction } from "@/app/(dashboard)/tasks/actions";

/** Mark done and Snooze appear when the row is pointed at or focused (always on touch); "Do now" is always there. Each confirms with a toast. */
export function OverdueFollowupsRowActions({ taskId, clientId }: { taskId: string; clientId: string }) {
  const [pending, setPending] = useState(false);

  async function run(action: () => Promise<unknown>, done: string, fail: string) {
    setPending(true);
    try {
      await action();
      toast.success(done);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : fail);
    } finally {
      setPending(false);
    }
  }

  const link = "text-[11px] font-bold text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50";
  return (
    <div className="flex shrink-0 items-center gap-3">
      <span className={cn(rowReveal, "flex items-center gap-3")}>
        <button type="button" disabled={pending} className={link} onClick={() => run(() => completeTaskAction(taskId), "Marked done", "Failed to mark done")}>
          Mark done
        </button>
        <button type="button" disabled={pending} className={link} onClick={() => run(() => updateTaskAction(taskId, { dueAt: new Date(Date.now() + 86400000).toISOString() }), "Snoozed to tomorrow", "Failed to snooze")}>
          Snooze
        </button>
      </span>
      <Link href={`/clients/${clientId}`} className="text-[11px] font-bold text-primary hover:underline">
        Do now
      </Link>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { updateTaskAction } from "@/app/(dashboard)/tasks/actions";

export function OverdueFollowupsRowActions({ taskId, clientId }: { taskId: string; clientId: string }) {
  const [pending, setPending] = useState(false);

  async function handleSnooze() {
    setPending(true);
    try {
      const tomorrow = new Date(Date.now() + 86400000);
      await updateTaskAction(taskId, { dueAt: tomorrow.toISOString() });
      toast.success("Snoozed to tomorrow");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to snooze");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-3">
      <button
        type="button"
        onClick={handleSnooze}
        disabled={pending}
        className="text-[11px] font-bold text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
      >
        Snooze
      </button>
      <Link href={`/clients/${clientId}`} className="text-[11px] font-bold text-primary hover:underline">
        Do now
      </Link>
    </div>
  );
}

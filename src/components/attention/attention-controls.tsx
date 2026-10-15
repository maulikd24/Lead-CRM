"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type AttentionAct = (itemId: string, mode: "dismiss" | "snooze", hours: number, reason: string) => Promise<{ ok: true } | { ok: false; error: string }>;

const SNOOZES = [
  { hours: 1, label: "1 hour" },
  { hours: 4, label: "4 hours" },
  { hours: 24, label: "1 day" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "1 week" },
] as const;

/**
 * Snooze or dismiss one item. A complaint, compliance or critical item cannot be dismissed and can be snoozed for 24 hours at most, with a
 * reason: the buttons say so before the server is asked, and the server enforces it again. Both are audited.
 */
export function AttentionControls({ itemId, hard, act }: { itemId: string; hard: boolean; act: AttentionAct }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [hours, setHours] = useState<number>(hard ? 4 : 24);
  const [reason, setReason] = useState("");
  const options = hard ? SNOOZES.filter((s) => s.hours <= 24) : SNOOZES;

  const run = (mode: "dismiss" | "snooze") =>
    start(async () => {
      try {
        const r = await act(itemId, mode, hours, reason);
        if (r.ok) {
          toast.success(mode === "dismiss" ? "Dismissed. It will not come back." : "Snoozed. It will come back.");
          router.refresh();
        } else toast.error(r.error);
      } catch {
        toast.error("Could not do that. Try again.");
      }
    });

  return (
    <div className="flex flex-col gap-2">
      {hard && <p className="text-xs text-muted-foreground">This cannot be dismissed. You can snooze it for up to 24 hours, with a reason.</p>}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Snooze for
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className="h-8 rounded-lg border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring">
            {options.map((o) => <option key={o.hours} value={o.hours}>{o.label}</option>)}
          </select>
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted-foreground">
          {hard ? "Reason (required)" : "Reason (optional)"}
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="h-8" />
        </label>
        <Button size="sm" variant="outline" disabled={pending || (hard && reason.trim() === "")} onClick={() => run("snooze")}>Snooze</Button>
        {!hard && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("dismiss")}>Dismiss</Button>}
      </div>
    </div>
  );
}

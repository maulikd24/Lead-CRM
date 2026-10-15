"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { requestCleverTapBatchApprovalAction } from "./actions";

/** Admin asks for the current CleverTap batch to be approved. The batch is frozen at request time and sent only after a different Admin approves it. */
export function BatchApprovalRequest() {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  function handleRequest() {
    startTransition(async () => {
      try {
        const r = await requestCleverTapBatchApprovalAction();
        setNote(`Requested: ${r.count} customers, region ${r.region || "default"}. A different Admin approves it in the approvals queue.`);
        toast.success("Batch sent for approval");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not request a batch";
        setNote(message);
        toast.error(message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 text-xs">
      <Button size="sm" variant="outline" onClick={handleRequest} disabled={pending}>
        Request batch approval
      </Button>
      {note && <p role="status" className="text-muted-foreground">{note}</p>}
    </div>
  );
}

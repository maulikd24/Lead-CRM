"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { acknowledgeDataHealthAction, retryDeadLetterAction, runDataHealthNowAction } from "./data-health-actions";

export function AcknowledgeItemButton({ itemId, label }: { itemId: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="outline" disabled={pending} aria-label={`Acknowledge ${label}`} onClick={() => start(async () => {
      try {
        const r = await acknowledgeDataHealthAction(itemId);
        toast[r.ok ? "success" : "error"](r.ok ? "Acknowledged. It stays listed until the problem is fixed." : "Could not acknowledge.");
      } catch {
        toast.error("Could not acknowledge. Try again.");
      }
    })}>{pending ? "Saving" : "Acknowledge"}</Button>
  );
}

export function RunChecksButton() {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
      try {
        const r = await runDataHealthNowAction();
        if (!r.ok) toast.error(r.reason === "flag-off" ? "Customer events are off, so the checks do not run." : "Could not run the checks.");
        else toast.success(`Checks finished: ${r.findings ?? 0} finding${r.findings === 1 ? "" : "s"}.`);
      } catch {
        toast.error("Could not run the checks. Try again.");
      }
    })}>{pending ? "Running" : "Run checks now"}</Button>
  );
}

const RETRY_REASON: Record<string, string> = { handler_failed: "It failed again.", not_found: "That entry no longer exists.", unknown_consumer: "That consumer is no longer registered.", outbound_consumers_are_not_retried_by_hand: "This consumer can send, so it is not retried by hand." };

export function RetryDeadLetterButton({ id, label }: { id: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="outline" disabled={pending} aria-label={`Retry ${label}`} onClick={() => start(async () => {
      try {
        const r = await retryDeadLetterAction(id);
        if (r.ok) toast.success("Retried and resolved."); else toast.error(RETRY_REASON[r.reason ?? ""] ?? "Could not retry.");
      } catch {
        toast.error("Could not retry. Try again.");
      }
    })}>{pending ? "Retrying" : "Retry"}</Button>
  );
}

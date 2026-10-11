"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { decideVersionAction, retireProductAction, reviseProductAction, submitVersionAction, suspendProductAction } from "./actions";

type Res = { ok: true; message: string } | { ok: false; error: string };

function useRun() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Res>) =>
    start(async () => {
      try {
        const r = await fn();
        if (r.ok) toast.success(r.message);
        else toast.error(r.error);
      } catch {
        toast.error("Could not complete that. Try again.");
      }
    });
  return { pending, run };
}

export function ReviseButton({ productId }: { productId: string }) {
  const { pending, run } = useRun();
  return <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => reviseProductAction(productId))}>{pending ? "Working" : "Revise (new draft)"}</Button>;
}

export function SubmitButton({ versionId }: { versionId: string }) {
  const { pending, run } = useRun();
  return <Button size="sm" disabled={pending} onClick={() => run(() => submitVersionAction(versionId))}>{pending ? "Submitting" : "Submit for review"}</Button>;
}

/** Approve or reject. The author cannot approve their own version: the server refuses it and says why. */
export function ReviewButtons({ versionId }: { versionId: string }) {
  const { pending, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Review note (optional)
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending} onClick={() => run(() => decideVersionAction(versionId, "approve", note))}>Approve</Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => decideVersionAction(versionId, "reject", note))}>Reject</Button>
      </div>
    </div>
  );
}

/** Suspend (reversible: approving a new version reinstates) or retire (final). A reason is required for both. */
export function StatusButtons({ productId, status }: { productId: string; status: string }) {
  const { pending, run } = useRun();
  const [reason, setReason] = useState("");
  const [confirmRetire, setConfirmRetire] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Reason (required)
        <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        {status === "APPROVED" && <Button size="sm" variant="outline" disabled={pending || reason.trim() === ""} onClick={() => run(() => suspendProductAction(productId, reason))}>Suspend now</Button>}
        {!confirmRetire ? (
          <Button size="sm" variant="outline" disabled={pending || reason.trim() === ""} onClick={() => setConfirmRetire(true)}>Retire</Button>
        ) : (
          <>
            <span className="text-xs text-muted-foreground">Retiring is final.</span>
            <Button size="sm" variant="destructive" disabled={pending} onClick={() => run(() => retireProductAction(productId, reason))}>Confirm retire</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmRetire(false)}>Cancel</Button>
          </>
        )}
      </div>
    </div>
  );
}

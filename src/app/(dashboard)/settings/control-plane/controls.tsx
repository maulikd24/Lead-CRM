"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { acknowledgeAlertAction, retryJobAction, retryLeadsAction } from "./actions";

const REFRESH_COOLDOWN_S = 10;

/** Re-reads the page. Once per 10 seconds, so nobody can hammer the database from this button. */
export function RefreshButton() {
  const router = useRouter();
  const [wait, setWait] = useState(0);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  return (
    <Button size="sm" variant="outline" disabled={wait > 0 || pending} onClick={() => { setWait(REFRESH_COOLDOWN_S); start(() => router.refresh()); }}>
      <RefreshCw className="size-3.5" aria-hidden /> {wait > 0 ? `Refresh (${wait})` : "Refresh"}
    </Button>
  );
}

const REASON: Record<string, string> = {
  "not-found": "That run no longer exists.", "not-failed": "That run did not fail.", "not-failing": "The job is no longer failing: nothing to retry.",
  "not-safe": "This job sends or changes things, so it cannot be re-run by hand.", "no-runner": "This job cannot be re-run by hand.", dead: "Retried too many times: it needs a person.",
  "tick-running": "A scheduler tick is running. Try again in a minute.",
};

export function RetryJobButton({ runId, label }: { runId: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="outline" disabled={pending} aria-label={`Retry ${label}`} onClick={() => start(async () => {
      try {
        const r = await retryJobAction(runId);
        if (r.outcome === "refused") toast.error(REASON[r.reason] ?? "Could not retry.");
        else toast[r.ok ? "success" : "error"](r.ok ? `${label} ran again and succeeded.` : `${label} ran again and failed again.`);
      } catch {
        toast.error("Could not retry. Try again.");
      }
    })}>{pending ? "Retrying" : "Retry"}</Button>
  );
}

export function RetryLeadsButton({ ids, label }: { ids: string[]; label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="outline" disabled={pending} aria-label={`Retry ${label}`} onClick={() => start(async () => {
      try {
        const r = await retryLeadsAction(ids);
        toast.success(`${r.recovered} recovered, ${r.stillFailing} still failing${r.skipped ? `, ${r.skipped} skipped` : ""}.`);
      } catch {
        toast.error("Could not retry. Try again.");
      }
    })}>{pending ? "Retrying" : `Retry ${ids.length}`}</Button>
  );
}

export function AcknowledgeButton({ alertId }: { alertId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
      try {
        const r = await acknowledgeAlertAction(alertId);
        toast[r.ok ? "success" : "error"](r.ok ? "Acknowledged. You will not be notified again about this one." : "Could not acknowledge.");
      } catch {
        toast.error("Could not acknowledge. Try again.");
      }
    })}>Acknowledge</Button>
  );
}

/** A prefilled email DRAFT: addressed to nobody, copied or opened in the Admin's own mail program. The system sends nothing. */
export function EmailDraftBlock({ subject, body, mailto }: { subject: string; body: string; mailto: string }) {
  return (
    <details className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
      <summary className="cursor-pointer font-medium">Email draft</summary>
      <p className="mt-2 text-muted-foreground">A draft for you to send yourself. Nothing is sent from here.</p>
      <p className="mt-2 font-medium">{subject}</p>
      <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-background p-2 font-sans">{body}</pre>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="xs" variant="outline" onClick={() => { void navigator.clipboard?.writeText(`${subject}\n\n${body}`).then(() => toast.success("Draft copied")).catch(() => toast.error("Could not copy")); }}>Copy</Button>
        <a href={mailto} className="inline-flex h-6 items-center rounded-md border border-border px-2 text-xs font-medium hover:bg-muted">Open in mail program</a>
      </div>
    </details>
  );
}

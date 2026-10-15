"use client";

import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { decideDigestAction, refreshAuditAction } from "./actions";

export type DigestView = { id: string; weekStart: string; subject: string; body: string; status: "DRAFT" | "APPROVED" | "DISCARDED" };

/** The weekly digest: what the in-app notification points at, and the draft email a person approves before anything is sent. */
export function DigestPanel({ digest, lastAudit }: { digest: DigestView | null; lastAudit: string | null }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>{lastAudit ? `Last audit ${lastAudit}.` : "No audit has run yet."}</span>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { const r = await refreshAuditAction(); setMsg(r.ok ? "Audit refreshed." : r.error); })}>Run the audit now</Button>
      </div>
      {digest ? (
        <section aria-label="Weekly digest draft" className="space-y-2 rounded-xl border p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2"><strong>{digest.subject}</strong><Badge variant={digest.status === "APPROVED" ? "success" : digest.status === "DISCARDED" ? "outline" : "warning"}>{digest.status === "DRAFT" ? "draft, not sent" : digest.status === "APPROVED" ? "approved and sent" : "discarded"}</Badge></div>
          <pre className="whitespace-pre-wrap font-sans text-sm text-muted-foreground">{digest.body}</pre>
          {digest.status === "DRAFT" ? (
            <div className="flex gap-2">
              <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await decideDigestAction(digest.id, "approve"); setMsg(r.ok ? "Approved. The email has been sent." : r.error); })}>Approve and send</Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { const r = await decideDigestAction(digest.id, "discard"); setMsg(r.ok ? "Discarded." : r.error); })}>Discard</Button>
            </div>
          ) : null}
        </section>
      ) : <p className="text-sm text-muted-foreground">No digest yet. The first one is written on Monday morning (India time) once the weekly digest is switched on.</p>}
      {msg ? <p role="status" className="text-sm">{msg}</p> : null}
      <p className="text-xs text-muted-foreground">The digest carries totals and the top issues only: no customer data. The email goes to Admin and Marketing users and only after a person approves it.</p>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GRACE_MAX, SLA_MAX, SLA_MIN, type AttributionSettings } from "@/lib/attribution/settings";

import { saveAttributionSettingsAction } from "./actions";

/** The speed-to-lead SLA. Saving changes new pushes and the leakage view; it never touches a customer. */
export function SettingsForm({ initial, canEdit }: { initial: AttributionSettings; canEdit: boolean }) {
  const [sla, setSla] = useState(String(initial.slaMinutes));
  const [grace, setGrace] = useState(String(initial.graceMinutes));
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const input = "native-control h-9 w-28";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    start(async () => {
      const r = await saveAttributionSettingsAction({ slaMinutes: sla, graceMinutes: grace });
      setMessage(r.ok ? { tone: "ok", text: `Saved. New leads must be contacted within ${r.settings.slaMinutes} minutes.` } : { tone: "error", text: r.error });
    });
  }

  if (!canEdit) {
    return (
      <Card role="region" aria-labelledby="lead-sla-title">
        <CardHeader>
          <CardTitle id="lead-sla-title" className="font-heading text-base">Speed to lead</CardTitle>
          <CardDescription>How fast a new lead must be reached, and what happens when it is not. Only an Admin can change these. Nothing is ever sent to the customer automatically.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid max-w-xl gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">Contact within</dt><dd className="font-medium tabular-nums">{initial.slaMinutes} minutes</dd></div>
            <div><dt className="text-muted-foreground">Wait before escalating</dt><dd className="font-medium tabular-nums">{initial.graceMinutes} minutes</dd></div>
          </dl>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card role="region" aria-labelledby="lead-sla-title">
      <CardHeader>
        <CardTitle id="lead-sla-title" className="font-heading text-base">Speed to lead</CardTitle>
        <CardDescription>How fast a new lead must be reached, and what happens when it is not. Nothing is ever sent to the customer automatically.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid max-w-xl gap-4" aria-label="Speed to lead settings">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Contact within (minutes)</span>
            <input className={input} type="number" inputMode="numeric" min={SLA_MIN} max={SLA_MAX} step={1} value={sla} onChange={(e) => setSla(e.target.value)} required aria-describedby="sla-help" />
            <span id="sla-help" className="text-xs text-muted-foreground">From {SLA_MIN} to {SLA_MAX}. The clock starts when the lead arrives and stops when a person calls, messages or logs a contact.</span>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Wait before escalating (minutes)</span>
            <input className={input} type="number" inputMode="numeric" min={0} max={GRACE_MAX} step={1} value={grace} onChange={(e) => setGrace(e.target.value)} required aria-describedby="grace-help" />
            <span id="grace-help" className="text-xs text-muted-foreground">0 escalates the moment the SLA is missed. The manager gets a task and a notification.</span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving" : "Save"}</Button>
            {message && <p role="status" className={message.tone === "error" ? "text-sm text-destructive" : "text-sm text-success"}>{message.text}</p>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

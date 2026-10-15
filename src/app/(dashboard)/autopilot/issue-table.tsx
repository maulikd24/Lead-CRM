"use client";

import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DENY_REASONS, type Recommendation } from "@/lib/autopilot/recommendations";

import { applyRecommendationAction, decideAction } from "./actions";
import { SEVERITY_BADGE } from "./ui";

/** Issue, then the action Autopilot proposes, then Approve or Deny. Deny asks why; the reason shapes later proposals. */
export function IssueTable({ recs, canApply }: { recs: Recommendation[]; canApply: boolean }) {
  const [denying, setDenying] = useState<string | null>(null);
  const [code, setCode] = useState("not_relevant");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ id: string; text: string } | null>(null);
  const [pending, start] = useTransition();

  const run = (id: string, fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => { const r = await fn(); setMsg(r.ok ? null : { id, text: r.error ?? "Failed" }); if (r.ok) setDenying(null); });

  if (recs.length === 0) return <p className="text-sm text-muted-foreground">No open issues. Autopilot checks again each time you open this page.</p>;
  return (
    <div role="region" aria-label="Issues and proposed actions" tabIndex={0} className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Issues and the action proposed for each</caption>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-3 font-medium">Issue</th>
            <th scope="col" className="hidden py-2 pr-3 font-medium md:table-cell">Proposed action</th>
            <th scope="col" className="py-2 font-medium">Decision</th>
          </tr>
        </thead>
        <tbody>
          {recs.map((r) => (
            <tr key={r.id} className="border-b align-top">
              <td className="py-3 pr-3">
                <div className="flex flex-wrap items-center gap-1.5"><Badge variant={SEVERITY_BADGE[r.severity]}>{r.severity}</Badge><span className="text-xs text-muted-foreground">{r.category}</span></div>
                <p className="mt-1">{r.issue}</p>
                {r.evidence.length ? <p className="mt-0.5 text-xs text-muted-foreground">{r.evidence.slice(0, 3).join(" · ")}</p> : null}
                <p className="mt-1 text-xs md:hidden"><strong>Proposed:</strong> {r.action.summary}</p>
              </td>
              <td className="hidden py-3 pr-3 md:table-cell">
                <p>{r.action.summary}</p>
                {r.impact.text ? <p className="mt-0.5 text-xs text-muted-foreground">{r.impact.text}</p> : null}
                <p className="mt-0.5 text-xs text-muted-foreground">Confidence {r.confidence}{r.appliable ? "" : " · a task for a person"}</p>
              </td>
              <td className="py-3">
                {r.status === "PENDING" ? (
                  denying === r.id ? (
                    <div className="space-y-1.5">
                      <label className="block text-xs" htmlFor={`why-${r.id}`}>Why deny?</label>
                      <select id={`why-${r.id}`} className="h-8 w-full rounded-md border bg-background px-2 text-sm" value={code} onChange={(e) => setCode(e.target.value)}>
                        {DENY_REASONS.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
                      </select>
                      <Input aria-label="Note (optional)" placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="destructive" disabled={pending} onClick={() => run(r.id, () => decideAction(r.id, "deny", { reasonCode: code, note }))}>Deny</Button>
                        <Button size="sm" variant="ghost" onClick={() => setDenying(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" disabled={pending} onClick={() => run(r.id, () => decideAction(r.id, "approve"))}>Approve</Button>
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => { setDenying(r.id); setNote(""); }}>Deny</Button>
                    </div>
                  )
                ) : r.status === "APPROVED" ? (
                  <div className="space-y-1">
                    <Badge variant="success">Approved</Badge>
                    {r.appliable && canApply ? <div><Button size="sm" variant="outline" disabled={pending} onClick={() => run(r.id, () => applyRecommendationAction(r.id))}>Apply to ad account</Button></div> : <p className="text-xs text-muted-foreground">{r.appliable ? "Applying is switched off. Make the change in the ad account." : "Recorded for the team."}</p>}
                  </div>
                ) : <Badge variant={r.status === "DENIED" ? "outline" : r.status === "FAILED" ? "destructive" : "secondary"}>{r.status.toLowerCase()}</Badge>}
                {msg?.id === r.id ? <p role="alert" className="mt-1 text-xs text-destructive">{msg.text}</p> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

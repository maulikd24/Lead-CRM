"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Answer } from "@/lib/autopilot/ask";

import { askAutopilotAction } from "./actions";

const EXAMPLES = ["How much are we wasting?", "Which cities give the cheapest funded customer?", "Are any campaigns off pace?", "When should we staff more?"];

/** Ask in plain words. Answers come from our own numbers, cite them, show the data age, and never change anything. */
export function AskBox({ enabled }: { enabled: boolean }) {
  const [q, setQ] = useState("");
  const [a, setA] = useState<Answer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ask = (text: string) => start(async () => { const r = await askAutopilotAction(text); if (r.ok) { setA(r.answer); setErr(null); } else setErr(r.error); });
  if (!enabled) return <p className="text-sm text-muted-foreground">Ask Autopilot is switched off on this server.</p>;
  return (
    <div className="space-y-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <Input aria-label="Your question" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about spend, regions, timing, tracking..." maxLength={500} />
        <Button type="submit" disabled={pending}>Ask</Button>
      </form>
      <div className="flex flex-wrap gap-1.5">{EXAMPLES.map((x) => <Button key={x} size="sm" variant="outline" disabled={pending} onClick={() => { setQ(x); ask(x); }}>{x}</Button>)}</div>
      {err ? <p role="alert" className="text-sm text-destructive">{err}</p> : null}
      {a ? (
        <section aria-live="polite" className="space-y-2 rounded-xl border p-4 text-sm">
          {a.lines.map((l, i) => <p key={i}>{l}</p>)}
          {a.cites.length ? <p className="text-xs text-muted-foreground">Numbers used: {a.cites.map((c) => `${c.label} ${c.value}`).join(" · ")}</p> : null}
          <p className="text-xs text-muted-foreground">Data {a.dataAge} (as of {a.asOf.slice(0, 16).replace("T", " ")} UTC). Tools used: {a.toolsUsed.join(", ")}.</p>
          {a.draftProposals.length ? (<div><p className="font-medium">Draft suggestions (nothing has been done)</p><ul className="list-disc pl-5">{a.draftProposals.map((p) => <li key={p.id}>{p.action.summary}</li>)}</ul><p className="text-xs text-muted-foreground">Approve or deny them in Issues and actions.</p></div>) : null}
          <p className="text-xs text-muted-foreground">{a.note}</p>
        </section>
      ) : null}
    </div>
  );
}

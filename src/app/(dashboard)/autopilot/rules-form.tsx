"use client";

import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RULE_METRICS } from "@/lib/autopilot/rules";

import { saveRuleAction, toggleRuleAction } from "./actions";

export type RuleView = { id: string; name: string; enabled: boolean; sentence: string };
const select = "h-9 rounded-md border bg-background px-2 text-sm";

/** "If [measure] is [above] [limit] over [N] days, propose [action]". A rule only ever proposes. */
export function RulesForm({ rules }: { rules: RuleView[] }) {
  const [v, setV] = useState({ name: "", metric: "cost_per_funded", op: ">", threshold: "", days: "14", action: "pause_campaign" });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await saveRuleAction(v); setMsg(r.ok ? "Rule saved. It will propose, never act." : r.error); }); }}>
        <div className="grid gap-1 text-sm"><label htmlFor="rf-name">Name</label><Input id="rf-name" value={v.name} onChange={set("name")} required maxLength={80} /></div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="grid gap-1"><label htmlFor="rf-m">If this measure</label><select id="rf-m" className={select} value={v.metric} onChange={set("metric")}>{Object.entries(RULE_METRICS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select></div>
          <div className="grid gap-1"><label htmlFor="rf-op">is</label><select id="rf-op" className={select} value={v.op} onChange={set("op")}><option value=">">above</option><option value="<">below</option></select></div>
          <div className="grid gap-1"><label htmlFor="rf-t">this limit</label><Input id="rf-t" inputMode="decimal" value={v.threshold} onChange={set("threshold")} required /></div>
          <div className="grid gap-1"><label htmlFor="rf-d">over the last (days)</label><Input id="rf-d" inputMode="numeric" value={v.days} onChange={set("days")} required /></div>
        </div>
        <div className="grid gap-1 text-sm"><label htmlFor="rf-a">then propose</label><select id="rf-a" className={select} value={v.action} onChange={set("action")}><option value="pause_campaign">Pause the campaign</option><option value="reduce_budget">Reduce the budget</option><option value="review_manually">Review by a person</option></select></div>
        <Button type="submit" disabled={pending}>Save rule</Button>
        {msg ? <p role="status" className="text-sm">{msg}</p> : null}
        <p className="text-xs text-muted-foreground">A rule stays quiet when there are too few leads behind a measure, and its result is a proposal on the Issues tab that a person must approve.</p>
      </form>
      <ul className="space-y-2">
        {rules.length === 0 ? <li className="text-sm text-muted-foreground">No rules yet.</li> : rules.map((r) => (
          <li key={r.id} className="flex items-start justify-between gap-2 rounded-xl border p-3 text-sm">
            <span><strong>{r.name}</strong><span className="block text-xs text-muted-foreground">{r.sentence}</span></span>
            <span className="flex items-center gap-2"><Badge variant={r.enabled ? "success" : "outline"}>{r.enabled ? "on" : "off"}</Badge><Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { await toggleRuleAction(r.id, !r.enabled); })}>{r.enabled ? "Turn off" : "Turn on"}</Button></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

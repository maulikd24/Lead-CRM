"use client";

import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RULE_METRICS, type RulePreview } from "@/lib/autopilot/rules";

import { draftRuleAction, previewRuleAction, saveRuleAction, saveSecondApproverAction, toggleRuleAction } from "./actions";

export type RuleView = { id: string; name: string; enabled: boolean; sentence: string };
export type ScopeCampaign = { id: string; name: string; accountId: string | null };
const select = "h-9 rounded-md border bg-background px-2 text-sm";

/** "If [measure] is [above] [limit] over [N] days, propose [action]". A rule only ever proposes. A draft can be written from a sentence (through the AI gateway), previewed and scoped to ad accounts and campaigns before it is saved. */
export function RulesForm({ rules, campaigns, aiEnabled, secondApprover }: { rules: RuleView[]; campaigns: ScopeCampaign[]; aiEnabled: boolean; secondApprover: boolean }) {
  const [v, setV] = useState({ name: "", metric: "cost_per_funded", op: ">", threshold: "", days: "14", action: "pause_campaign" });
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [campaignIds, setCampaignIds] = useState<string[]>([]);
  const [sentence, setSentence] = useState("");
  const [drafted, setDrafted] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<RulePreview | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => { setV((p) => ({ ...p, [k]: e.target.value })); setPreview(null); };
  const accounts = [...new Set(campaigns.flatMap((c) => (c.accountId ? [c.accountId] : [])))];
  const scope = { ...v, accountIds, campaignIds };
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        {aiEnabled ? (
          <div className="space-y-1.5 rounded-xl border p-3 text-sm">
            <label htmlFor="rf-sentence" className="font-medium">Describe a rule in a sentence</label>
            <Input id="rf-sentence" value={sentence} onChange={(e) => setSentence(e.target.value)} maxLength={500} placeholder="Pause the demat campaign if a funded customer costs over 4000 for two weeks" />
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={pending || sentence.trim().length < 5} onClick={() => start(async () => {
                const r = await draftRuleAction(sentence);
                if (!r.ok) { setMsg(r.error); return; }
                const d = r.rule;
                setV({ name: d.name, metric: d.metric, op: d.op, threshold: String(d.threshold), days: String(d.days), action: d.action });
                setCampaignIds(d.campaignIds ?? []); setAccountIds(d.accountIds ?? []); setDrafted(true); setPreview(null); setMsg(r.note);
              })}>Draft the rule</Button>
              <span className="text-xs text-muted-foreground">A draft only fills in the form below. Nothing is saved until you save it.</span>
            </div>
          </div>
        ) : null}
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await saveRuleAction({ ...scope, drafted }); setMsg(r.ok ? "Rule saved. It will propose, never act." : r.error); }); }}>
          <div className="grid gap-1 text-sm"><label htmlFor="rf-name">Name</label><Input id="rf-name" value={v.name} onChange={set("name")} required maxLength={80} /></div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="grid gap-1"><label htmlFor="rf-m">If this measure</label><select id="rf-m" className={select} value={v.metric} onChange={set("metric")}>{Object.entries(RULE_METRICS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select></div>
            <div className="grid gap-1"><label htmlFor="rf-op">is</label><select id="rf-op" className={select} value={v.op} onChange={set("op")}><option value=">">above</option><option value="<">below</option></select></div>
            <div className="grid gap-1"><label htmlFor="rf-t">this limit</label><Input id="rf-t" inputMode="decimal" value={v.threshold} onChange={set("threshold")} required /></div>
            <div className="grid gap-1"><label htmlFor="rf-d">over the last (days)</label><Input id="rf-d" inputMode="numeric" value={v.days} onChange={set("days")} required /></div>
          </div>
          <div className="grid gap-1 text-sm"><label htmlFor="rf-a">then propose</label><select id="rf-a" className={select} value={v.action} onChange={set("action")}><option value="pause_campaign">Pause the campaign</option><option value="reduce_budget">Reduce the budget</option><option value="review_manually">Ask a person to review</option><option value="refresh_creative">Brief new creative</option></select></div>
          {accounts.length > 1 ? (
            <fieldset className="grid gap-1 text-sm"><legend className="mb-1">Ad accounts (none ticked means every account)</legend>
              {accounts.map((a) => <label key={a} className="flex items-center gap-2"><input type="checkbox" checked={accountIds.includes(a)} onChange={() => { setAccountIds(toggle(accountIds, a)); setPreview(null); }} />Account {a}</label>)}
            </fieldset>
          ) : null}
          {campaigns.length > 1 ? (
            <details className="text-sm"><summary className="cursor-pointer">Limit to some campaigns{campaignIds.length ? ` (${campaignIds.length})` : ""}</summary>
              <fieldset className="mt-1 grid gap-1"><legend className="sr-only">Campaigns</legend>
                {campaigns.map((c) => <label key={c.id} className="flex items-center gap-2"><input type="checkbox" checked={campaignIds.includes(c.id)} onChange={() => { setCampaignIds(toggle(campaignIds, c.id)); setPreview(null); }} />{c.name}</label>)}
              </fieldset>
            </details>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={() => start(async () => { const r = await previewRuleAction(scope); if (r.ok) { setPreview(r.preview); setMsg(null); } else setMsg(r.error); })}>Preview on today&apos;s data</Button>
            <Button type="submit" disabled={pending}>Save rule</Button>
          </div>
          {msg ? <p role="status" className="text-sm">{msg}</p> : null}
          {preview ? <PreviewView p={preview} /> : null}
          <p className="text-xs text-muted-foreground">A rule stays quiet when there are too few leads behind a measure, and its result is a proposal on the Issues tab that a person must approve.</p>
        </form>
      </div>
      <div className="space-y-3">
        <ul className="space-y-2">
          {rules.length === 0 ? <li className="text-sm text-muted-foreground">No rules yet.</li> : rules.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-2 rounded-xl border p-3 text-sm">
              <span><strong>{r.name}</strong><span className="block text-xs text-muted-foreground">{r.sentence}</span></span>
              <span className="flex items-center gap-2"><Badge variant={r.enabled ? "success" : "outline"}>{r.enabled ? "on" : "off"}</Badge><Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { await toggleRuleAction(r.id, !r.enabled); })}>{r.enabled ? "Turn off" : "Turn on"}</Button></span>
            </li>
          ))}
        </ul>
        <label className="flex items-start gap-2 rounded-xl border p-3 text-sm">
          <input type="checkbox" className="mt-1" defaultChecked={secondApprover} disabled={pending} onChange={(e) => start(async () => { await saveSecondApproverAction(e.target.checked); })} />
          <span><strong>Second pair of eyes</strong><span className="block text-xs text-muted-foreground">When on, the person who wrote a rule cannot approve what that rule proposes. Built-in checks are not affected.</span></span>
        </label>
      </div>
    </div>
  );
}

function PreviewView({ p }: { p: RulePreview }) {
  if (p.error) return <p role="status" className="text-sm text-destructive">{p.error}</p>;
  return (
    <section aria-label="Rule preview" className="space-y-1.5 rounded-xl border p-3 text-sm">
      <p><strong>{p.wouldPropose.length}</strong> would be proposed, <strong>{p.held.length}</strong> held (too little behind the measure), <strong>{p.quiet.length}</strong> within the limit. Window {p.window.from} to {p.window.to}. Nothing is changed by a preview.</p>
      <ul className="space-y-1 text-xs text-muted-foreground">
        {[...p.wouldPropose, ...p.held, ...p.quiet].slice(0, 8).map((r) => <li key={r.campaignId}><strong className="text-foreground">{r.campaignName}</strong>: {r.reason}</li>)}
      </ul>
    </section>
  );
}

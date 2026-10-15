"use client";

import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { LaunchDraft } from "@/lib/autopilot/launch";

import { activateDraftAction, discardDraftAction, launchPausedAction, previewLaunchAction, recordAnnexureAction, saveLaunchDraftAction } from "./actions";

export type SavedDraft = { id: string; name: string; status: string; complianceOk: boolean; annexureApproved: boolean; mine: boolean; estimates: { available: boolean; funded?: { low: number; high: number } } | null };

const field = "grid gap-1 text-sm";
const select = "h-9 rounded-md border bg-background px-2 text-sm";

/** The Create-campaign assistant. Preview shows estimates and the compliance checklist; saving makes a DRAFT only. */
export function LaunchForm({ drafts, applyOn }: { drafts: SavedDraft[]; applyOn: boolean }) {
  const [v, setV] = useState({ name: "", objective: "funded_customers", platform: "meta", totalBudget: "", days: "30", audience: "", geoKind: "cities", geo: "", landingUrl: "https://", headline: "", body: "" });
  const [draft, setDraft] = useState<LaunchDraft | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  const payload = () => ({ name: v.name, objective: v.objective, platform: v.platform, totalBudget: v.totalBudget, days: v.days, audience: { description: v.audience }, geo: { kind: v.geoKind, values: v.geo }, landingUrl: v.landingUrl, copy: { headline: v.headline, body: v.body } });
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => start(async () => { const r = await fn(); setMsg(r.ok ? okText : (r.error ?? "Failed")); });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await previewLaunchAction(payload()); if (r.ok) { setDraft(r.draft); setMsg(null); } else setMsg(r.error); }); }}>
        <div className={field}><label htmlFor="lf-name">Campaign name</label><Input id="lf-name" value={v.name} onChange={set("name")} required maxLength={120} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className={field}><label htmlFor="lf-obj">Objective</label><select id="lf-obj" className={select} value={v.objective} onChange={set("objective")}><option value="funded_customers">Funded customers</option><option value="leads">Leads</option></select></div>
          <div className={field}><label htmlFor="lf-plat">Platform</label><select id="lf-plat" className={select} value={v.platform} onChange={set("platform")}><option value="meta">Meta</option><option value="google">Google</option></select></div>
          <div className={field}><label htmlFor="lf-bud">Total budget (rupees)</label><Input id="lf-bud" inputMode="decimal" value={v.totalBudget} onChange={set("totalBudget")} required /></div>
          <div className={field}><label htmlFor="lf-days">Days to run</label><Input id="lf-days" inputMode="numeric" value={v.days} onChange={set("days")} required /></div>
        </div>
        <div className={field}><label htmlFor="lf-aud">Audience</label><Input id="lf-aud" value={v.audience} onChange={set("audience")} placeholder="For example: salaried, 25 to 40" maxLength={300} /></div>
        <div className="grid grid-cols-[8rem_1fr] gap-3">
          <div className={field}><label htmlFor="lf-gk">Where</label><select id="lf-gk" className={select} value={v.geoKind} onChange={set("geoKind")}><option value="cities">Cities</option><option value="states">States</option></select></div>
          <div className={field}><label htmlFor="lf-geo">Places (comma separated)</label><Input id="lf-geo" value={v.geo} onChange={set("geo")} required /></div>
        </div>
        <div className={field}><label htmlFor="lf-url">Landing page</label><Input id="lf-url" type="url" value={v.landingUrl} onChange={set("landingUrl")} required /></div>
        <div className={field}><label htmlFor="lf-head">Headline</label><Input id="lf-head" value={v.headline} onChange={set("headline")} maxLength={150} /></div>
        <div className={field}><label htmlFor="lf-body">Ad text</label><Textarea id="lf-body" rows={4} value={v.body} onChange={set("body")} maxLength={2000} /></div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>Preview estimates and checks</Button>
          <Button type="button" variant="outline" disabled={pending || !draft || draft.errors.length > 0} onClick={() => act(() => saveLaunchDraftAction(payload()), "Draft saved.")}>Save as draft</Button>
        </div>
        {msg ? <p role="status" className="text-sm">{msg}</p> : null}
      </form>

      <div className="space-y-4">
        {draft ? (
          <section aria-label="Draft preview" className="space-y-3 rounded-xl border p-4 text-sm">
            {draft.errors.map((e) => <p key={e} role="alert" className="text-destructive">{e}</p>)}
            <p><strong>Starts paused.</strong> Daily budget about {draft.dailyBudget.toLocaleString("en-IN")} rupees. Hours: {draft.schedule.hours}. Bidding: {draft.bidding.strategy}.</p>
            {draft.estimates.available ? (
              <div>
                <p className="font-medium">Estimates (ranges, based on our own past funnel)</p>
                <p className="tabular-nums">Clicks {draft.estimates.clicks.low.toLocaleString("en-IN")} to {draft.estimates.clicks.high.toLocaleString("en-IN")} · Leads {draft.estimates.leads.low} to {draft.estimates.leads.high} · Funded customers {draft.estimates.funded.low} to {draft.estimates.funded.high}</p>
                <p className="text-xs text-muted-foreground">{draft.estimates.label}</p>
                <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">{draft.estimates.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
              </div>
            ) : <p className="text-muted-foreground"><Badge variant="outline" className="mr-2">Not available</Badge>{draft.estimates.reason} Needs: {draft.estimates.needed.join("; ")}.</p>}
            <div>
              <p className="font-medium">Compliance checklist</p>
              <ul className="mt-1 space-y-1">{draft.checklist.map((c) => <li key={c.label} className="flex gap-2"><Badge variant={c.state === "pass" ? "success" : c.state === "fail" ? "destructive" : "warning"}>{c.state === "manual" ? "person" : c.state}</Badge><span>{c.label}<span className="block text-xs text-muted-foreground">{c.detail}</span></span></li>)}</ul>
            </div>
          </section>
        ) : <p className="text-sm text-muted-foreground">Fill in the form and preview. Nothing is created until you save a draft, and a launched campaign always starts paused.</p>}

        <section aria-label="Saved drafts">
          <h2 className="mb-2 font-heading text-sm font-bold">Saved drafts</h2>
          {drafts.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
            <ul className="space-y-2">{drafts.map((d) => (
              <li key={d.id} className="rounded-xl border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2"><strong>{d.name}</strong><Badge variant={d.status === "ACTIVE" ? "success" : "outline"}>{d.status === "LAUNCHED_PAUSED" ? "paused in ad account" : d.status.toLowerCase()}</Badge></div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {d.status === "DRAFT" ? (<>
                    <Button size="sm" variant="outline" onClick={() => setMsg("Change the form above and save again; the old draft can be discarded.")}>Edit first</Button>
                    <Button size="sm" disabled={pending || !d.complianceOk || !applyOn} title={applyOn ? undefined : "Creating campaigns is switched off on this server"} onClick={() => act(() => launchPausedAction(d.id), "Created paused in the ad account.")}>Launch as paused draft</Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => discardDraftAction(d.id), "Discarded.")}>Discard</Button>
                  </>) : null}
                  {d.status === "LAUNCHED_PAUSED" ? (<>
                    {!d.annexureApproved ? <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => recordAnnexureAction(d.id), "Annexure recorded.")}>Record signed annexure</Button> : <Badge variant="success">annexure recorded</Badge>}
                    <Button size="sm" disabled={pending || !d.annexureApproved || d.mine} title={d.mine ? "A second person turns it on" : undefined} onClick={() => act(() => activateDraftAction(d.id), "Turned on.")}>Turn on</Button>
                  </>) : null}
                </div>
                {d.status === "DRAFT" && !d.complianceOk ? <p className="mt-1 text-xs text-destructive">The compliance checklist has a failed item.</p> : null}
              </li>
            ))}</ul>
          )}
        </section>
      </div>
    </div>
  );
}

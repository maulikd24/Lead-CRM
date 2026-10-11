"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FilePlus2, Palette, Printer } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MasterDetail, Sheet, motion, useUrlSheet, type MasterItem } from "@/components/workspace";
import type { BriefsData, BriefView } from "@/lib/creative/briefs-db";
import { MAX_REFERENCES, referenceSummary } from "@/lib/creative/competitor";
import { HOOK_LABEL, type HookType } from "@/lib/creative/kit";

import { BrandForm } from "./brand-form";
import { attachReferenceAction, discardBriefAction, setAiCreativeAction } from "./creative-actions";
import { Labelled, StatusLine, fieldClass, useAction } from "./creative-ui";
import { NewBriefForm } from "./new-brief-form";
import { VariantCard } from "./variant-card";

function BriefDetail({ brief, data, viewerId, today }: { brief: BriefView; data: BriefsData; viewerId: string; today: string }) {
  const { run, pending, message } = useAction();
  const [ref, setRef] = useState("");
  const attached = data.references.filter((r) => brief.referenceIds.includes(r.id));
  const copies = useMemo(() => attached.map((r) => r.copy), [attached]);
  const available = data.references.filter((r) => !brief.referenceIds.includes(r.id));
  const approved = brief.variants.filter((v) => v.status === "APPROVED").length;
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-heading text-base font-semibold">{brief.title}</p>
          <p className="text-muted-foreground">{brief.topic} · {brief.audience} · {brief.language === "hinglish" ? "Hinglish" : "English"} · {HOOK_LABEL[brief.hookType as HookType] ?? brief.hookType}</p>
          <p className="text-xs text-muted-foreground">Checked against brand profile version {brief.brandVersion ?? 0}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {approved > 0 && (
            <Button size="sm" variant="outline" render={<Link href={`/creative-print/${brief.id}`} target="_blank" />}>
              <Printer aria-hidden className="size-4" /> Printable annexure ({approved})
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={pending || approved > 0} title={approved > 0 ? "A brief with approved copy cannot be deleted" : undefined} onClick={() => confirm("Delete this brief and its drafts?") && run(() => discardBriefAction(brief.id), "Brief deleted.")}>Delete</Button>
        </div>
      </div>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {([["Master hook", brief.master.hook], ["USP", brief.master.usp], ["Call to action", brief.master.cta]] as const).map(([k, v]) => (
          <div key={k} className="rounded-lg border border-border p-2"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>
        ))}
      </dl>
      <section aria-label="Competitor references" className="flex flex-col gap-1.5">
        <h3 className="font-heading text-sm font-semibold">Competitor references <span className="font-normal text-muted-foreground">(inspiration only)</span></h3>
        {attached.length === 0 ? <p className="text-xs text-muted-foreground">None attached. Attaching one adds its tags and facts to this brief, never its wording, and a draft that echoes it fails the originality check.</p> : (
          <ul className="flex flex-col gap-1 text-xs">{attached.map((r) => <li key={r.id}><strong className="font-medium">{r.competitor}</strong>: {referenceSummary(r, today)}</li>)}</ul>
        )}
        {available.length > 0 && attached.length < MAX_REFERENCES && (
          <div className="flex flex-wrap items-end gap-2">
            <Labelled label="Attach a reference" htmlFor={`ref-${brief.id}`} className="min-w-48 flex-1">
              <select id={`ref-${brief.id}`} className={fieldClass} value={ref} onChange={(e) => setRef(e.target.value)}>
                <option value="">Choose a saved competitor ad</option>
                {available.slice(0, 100).map((r) => <option key={r.id} value={r.id}>{r.competitor}: {r.hookTag ? r.hookTag.replace(/_/g, " ") : r.format}</option>)}
              </select>
            </Labelled>
            <Button size="sm" variant="outline" disabled={pending || !ref} onClick={() => run(() => attachReferenceAction(brief.id, ref), "Reference attached. The drafts were checked again.", () => setRef(""))}>Use as brief reference</Button>
          </div>
        )}
        <StatusLine message={message} />
      </section>
      <div className="flex flex-col gap-4">
        {brief.variants.map((v) => <VariantCard key={v.id} variant={v} brief={brief} profile={data.brand.profile} referenceCopies={copies} viewerId={viewerId} />)}
      </div>
    </div>
  );
}

function AiSwitch({ on }: { on: boolean }) {
  const { run, pending, message } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending} aria-pressed={on} onClick={() => run(() => setAiCreativeAction(!on), on ? "AI drafting is off." : "AI drafting is on.")}>{on ? "Turn AI drafting off" : "Turn AI drafting on"}</Button>
      <StatusLine message={message} />
    </div>
  );
}

export function BriefsView({ data, viewerId, isAdmin, today }: { data: BriefsData; viewerId: string; isAdmin: boolean; today: string }) {
  const newSheet = useUrlSheet("new-brief");
  const brandSheet = useUrlSheet("brand-profile");
  const items: MasterItem[] = data.briefs.map((b) => {
    const approved = b.variants.filter((v) => v.status === "APPROVED").length;
    const failing = b.variants.filter((v) => v.complianceStatus === "FAIL").length;
    return { id: b.id, title: b.title, meta: `${b.variants.length} variants · ${b.language === "hinglish" ? "Hinglish" : "English"}`, trailing: failing > 0 ? <Badge variant="destructive">{failing} failing</Badge> : <Badge variant={approved === b.variants.length && approved > 0 ? "success" : "outline"}>{approved}/{b.variants.length} approved</Badge> };
  });
  const details = Object.fromEntries(data.briefs.map((b) => [b.id, <BriefDetail key={b.id} brief={b} data={data} viewerId={viewerId} today={today} />]));
  const open = (id: string) => {
    newSheet.hide();
    const q = new URLSearchParams(window.location.search);
    q.set("item", id);
    window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}`);
  };

  return (
    <div className={`${motion.enter} flex min-h-0 flex-1 flex-col gap-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={newSheet.show} aria-haspopup="dialog"><FilePlus2 aria-hidden className="size-4" /> New brief</Button>
        <Button size="sm" variant="outline" onClick={brandSheet.show} aria-haspopup="dialog"><Palette aria-hidden className="size-4" /> Brand profile</Button>
        {isAdmin && <AiSwitch on={data.aiOn} />}
      </div>
      <Sheet name="new-brief" open={newSheet.open} onClose={newSheet.hide} title="New creative brief">
        <NewBriefForm aiOn={data.aiOn} references={data.references} today={today} onCreated={open} />
      </Sheet>
      <Sheet name="brand-profile" open={brandSheet.open} onClose={brandSheet.hide} title="Brand profile">
        <BrandForm profile={data.brand.profile} version={data.brand.version} />
      </Sheet>
      {data.briefs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">No briefs yet. Create one to get a master hook, a USP and a checked draft for each channel.</p>
      ) : (
        <MasterDetail idPrefix="briefs" label="Briefs" items={items} details={details} noun="briefs" />
      )}
    </div>
  );
}

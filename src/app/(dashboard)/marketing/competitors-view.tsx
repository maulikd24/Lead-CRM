"use client";

import { useRef, useState } from "react";
import { ExternalLink, FileUp, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MasterDetail, Sheet, motion, useUrlSheet, type MasterItem } from "@/components/workspace";
import { COMPETITOR_FORMATS, daysLive, referenceSummary } from "@/lib/creative/competitor";
import type { CompetitorAdView } from "@/lib/creative/competitor-db";
import { TAG_VOCAB } from "@/lib/creative/winners";

import { addCompetitorAction, addCompetitorAdAction, attachReferenceAction, importCompetitorCsvAction, removeCompetitorAdAction, removeCompetitorAction, setCompetitorAdTagsAction } from "./creative-actions";
import { Labelled, StatusLine, areaClass, fieldClass, tagLabel, useAction } from "./creative-ui";

type BriefOption = { id: string; title: string };

function AdDetail({ ad, today, briefs }: { ad: CompetitorAdView; today: string; briefs: BriefOption[] }) {
  const { run, pending, message } = useAction();
  const [hook, setHook] = useState(ad.hookTag ?? "");
  const [offer, setOffer] = useState(ad.offerTag ?? "");
  const [brief, setBrief] = useState("");
  const d = daysLive(ad.startDate, today);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><p className="font-heading text-base font-semibold">{ad.competitor}</p><p className="text-muted-foreground">{ad.format} ad · {d === null ? "start date unknown" : `live ${d} day${d === 1 ? "" : "s"}`}</p></div>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => confirm("Remove this ad from the list?") && run(() => removeCompetitorAdAction(ad.id), "Removed.")}>Remove</Button>
      </div>
      <blockquote className="whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-3 text-sm">{ad.copy}</blockquote>
      <p className="text-xs text-muted-foreground">Inspiration only. Never copy it: a draft that echoes this wording fails the originality check.</p>
      <div className="flex flex-wrap gap-3 text-xs">
        {ad.link && <a className="inline-flex items-center gap-1 text-primary underline underline-offset-2" href={ad.link} target="_blank" rel="noopener noreferrer nofollow">View original ad <ExternalLink aria-hidden className="size-3" /></a>}
        {ad.thumbnailRef && (/^https?:\/\//i.test(ad.thumbnailRef) ? <a className="inline-flex items-center gap-1 text-primary underline underline-offset-2" href={ad.thumbnailRef} target="_blank" rel="noopener noreferrer nofollow">Thumbnail <ExternalLink aria-hidden className="size-3" /></a> : <span>Thumbnail reference: <code>{ad.thumbnailRef}</code></span>)}
      </div>
      <section className="flex flex-col gap-2" aria-label="Tags">
        <div className="flex items-center gap-2"><h3 className="font-heading text-sm font-semibold">Tags</h3>{ad.tagStatus === "DRAFT" && <Badge variant="warning">Draft ({ad.tagSource === "AI" ? "AI" : "rule"} suggestion)</Badge>}</div>
        <div className="grid grid-cols-2 gap-2">
          <Labelled label="Hook" htmlFor={`ch-${ad.id}`}><select id={`ch-${ad.id}`} className={fieldClass} value={hook} onChange={(e) => setHook(e.target.value)}><option value="">Not set</option>{TAG_VOCAB.hook.map((v) => <option key={v} value={v}>{tagLabel(v)}</option>)}</select></Labelled>
          <Labelled label="Offer" htmlFor={`co-${ad.id}`}><select id={`co-${ad.id}`} className={fieldClass} value={offer} onChange={(e) => setOffer(e.target.value)}><option value="">Not set</option>{TAG_VOCAB.offer.map((v) => <option key={v} value={v}>{tagLabel(v)}</option>)}</select></Labelled>
        </div>
        <Button size="sm" variant="outline" className="self-start" disabled={pending} onClick={() => run(() => setCompetitorAdTagsAction(ad.id, { hook, offer }), "Tags confirmed.")}>{ad.tagStatus === "DRAFT" ? "Confirm tags" : "Save tags"}</Button>
      </section>
      <section className="flex flex-col gap-2" aria-label="Use as brief reference">
        <h3 className="font-heading text-sm font-semibold">Use as brief reference</h3>
        <p className="text-xs text-muted-foreground">{referenceSummary(ad, today)}</p>
        {briefs.length === 0 ? <p className="text-xs text-muted-foreground">Create a brief in the Briefs tab first.</p> : (
          <div className="flex flex-wrap items-end gap-2">
            <Labelled label="Attach to brief" htmlFor={`cb-${ad.id}`} className="min-w-48 flex-1"><select id={`cb-${ad.id}`} className={fieldClass} value={brief} onChange={(e) => setBrief(e.target.value)}><option value="">Choose a brief</option>{briefs.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}</select></Labelled>
            <Button size="sm" disabled={pending || !brief} onClick={() => run(() => attachReferenceAction(brief, ad.id), "Attached. The drafts were checked again for originality.")}>Attach</Button>
          </div>
        )}
      </section>
      <StatusLine message={message} />
    </div>
  );
}

function AddForms({ competitors }: { competitors: { id: string; name: string; ads: number }[] }) {
  const { run, pending, message } = useAction();
  const file = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [pageId, setPageId] = useState("");
  const [competitor, setCompetitor] = useState("");
  const [copy, setCopy] = useState("");
  const [format, setFormat] = useState("image");
  const [startDate, setStartDate] = useState("");
  const [link, setLink] = useState("");
  const [thumb, setThumb] = useState("");
  const [csv, setCsv] = useState("");
  const [csvResult, setCsvResult] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-muted-foreground">Competitor ads are added by hand or from a CSV file. Nothing is fetched from the internet, no scraper or vendor is connected, and only a pointer to a thumbnail is stored, never the image. An official ad library or a vendor could be added later once its terms and its coverage of Indian advertisers are checked.</p>
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); run(() => addCompetitorAction({ name, pageId }), "Competitor saved.", () => { setName(""); setPageId(""); }); }}>
        <h3 className="font-heading text-sm font-semibold">Save a competitor</h3>
        <div className="grid grid-cols-2 gap-2">
          <Labelled label="Page name" htmlFor="cp-name"><input id="cp-name" className={fieldClass} required value={name} onChange={(e) => setName(e.target.value)} /></Labelled>
          <Labelled label="Page id (optional)" htmlFor="cp-id"><input id="cp-id" className={fieldClass} value={pageId} onChange={(e) => setPageId(e.target.value)} /></Labelled>
        </div>
        <Button type="submit" size="sm" className="self-start" disabled={pending}><Plus aria-hidden className="size-4" /> Save competitor</Button>
      </form>
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); run(() => addCompetitorAdAction({ competitor, copy, format, startDate, link, thumbnailRef: thumb }), "Ad saved.", () => { setCopy(""); setLink(""); setThumb(""); setStartDate(""); }); }}>
        <h3 className="font-heading text-sm font-semibold">Add an ad by hand</h3>
        <Labelled label="Competitor" htmlFor="ca-comp"><input id="ca-comp" list="ca-list" className={fieldClass} required value={competitor} onChange={(e) => setCompetitor(e.target.value)} /><datalist id="ca-list">{competitors.map((c) => <option key={c.id} value={c.name} />)}</datalist></Labelled>
        <Labelled label="Ad copy" htmlFor="ca-copy"><textarea id="ca-copy" rows={3} className={areaClass} required maxLength={3000} value={copy} onChange={(e) => setCopy(e.target.value)} /></Labelled>
        <div className="grid grid-cols-2 gap-2">
          <Labelled label="Format" htmlFor="ca-fmt"><select id="ca-fmt" className={fieldClass} value={format} onChange={(e) => setFormat(e.target.value)}>{COMPETITOR_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}</select></Labelled>
          <Labelled label="Start date" htmlFor="ca-start"><input id="ca-start" type="date" className={fieldClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Labelled>
          <Labelled label="Link to the ad" htmlFor="ca-link"><input id="ca-link" className={fieldClass} inputMode="url" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} /></Labelled>
          <Labelled label="Thumbnail pointer" hint="A web address or a short reference. Not the image." htmlFor="ca-thumb"><input id="ca-thumb" className={fieldClass} value={thumb} onChange={(e) => setThumb(e.target.value)} /></Labelled>
        </div>
        <Button type="submit" size="sm" className="self-start" disabled={pending}>Save ad</Button>
      </form>
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); run(() => importCompetitorCsvAction(csv), "Import finished.", (r) => setCsvResult(`${r.added} added, ${r.duplicates} already saved${r.errors.length ? `, ${r.errors.length} rows skipped: ${r.errors.map((x) => `line ${x.line}: ${x.message}`).join("; ")}` : ""}.`)); }}>
        <h3 className="font-heading text-sm font-semibold">Import from CSV</h3>
        <p className="text-xs text-muted-foreground">Columns: competitor, copy, format, start_date (2026-09-30), link, thumbnail_ref. Up to 500 rows.</p>
        <input ref={file} type="file" accept=".csv,text/csv" aria-label="Choose a CSV file" className="text-xs" onChange={async (e) => { const f = e.target.files?.[0]; if (f && f.size < 500_000) setCsv(await f.text()); }} />
        <Labelled label="Or paste the CSV" htmlFor="ca-csv"><textarea id="ca-csv" rows={4} className={areaClass} value={csv} onChange={(e) => setCsv(e.target.value)} /></Labelled>
        <Button type="submit" size="sm" className="self-start" disabled={pending || !csv.trim()}><FileUp aria-hidden className="size-4" /> Import</Button>
        {csvResult && <p role="status" className="text-xs">{csvResult}</p>}
      </form>
      {competitors.length > 0 && (
        <section aria-label="Saved competitors" className="flex flex-col gap-1.5">
          <h3 className="font-heading text-sm font-semibold">Saved competitors</h3>
          <ul className="flex flex-col gap-1 text-sm">{competitors.map((c) => <li key={c.id} className="flex items-center justify-between gap-2"><span>{c.name} <span className="text-xs text-muted-foreground">({c.ads} ads)</span></span><Button size="xs" variant="ghost" disabled={pending} onClick={() => confirm(`Remove ${c.name} and its ads?`) && run(() => removeCompetitorAction(c.id), "Removed.")}>Remove</Button></li>)}</ul>
        </section>
      )}
      <StatusLine message={message} />
    </div>
  );
}

export function CompetitorsView({ ads, competitors, briefs, today }: { ads: CompetitorAdView[]; competitors: { id: string; name: string; ads: number }[]; briefs: BriefOption[]; today: string }) {
  const sheet = useUrlSheet("add-competitor");
  const items: MasterItem[] = ads.map((a) => {
    const d = daysLive(a.startDate, today);
    return { id: a.id, title: a.competitor, meta: a.copy.length > 70 ? `${a.copy.slice(0, 70)}…` : a.copy, trailing: <Badge variant={d !== null && d >= 30 ? "success" : "outline"}>{d === null ? "Unknown" : `${d}d`}</Badge> };
  });
  const details = Object.fromEntries(ads.map((a) => [a.id, <AdDetail key={a.id} ad={a} today={today} briefs={briefs} />]));
  return (
    <div className={`${motion.enter} flex min-h-0 flex-1 flex-col gap-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={sheet.show} aria-haspopup="dialog"><Plus aria-hidden className="size-4" /> Add competitor ads</Button>
        <p className="text-xs text-muted-foreground">Longest running first. An ad that has run for weeks is probably working for them; that is a clue, not proof.</p>
      </div>
      <Sheet name="add-competitor" open={sheet.open} onClose={sheet.hide} title="Add competitor ads"><AddForms competitors={competitors} /></Sheet>
      {ads.length === 0 ? <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">No competitor ads saved yet. Add a few by hand or import a CSV, then use them as inspiration for a brief.</p> : <MasterDetail idPrefix="competitors" label="Competitor ads" items={items} details={details} noun="ads" />}
    </div>
  );
}

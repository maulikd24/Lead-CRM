"use client";

import { useState } from "react";
import { Settings2, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MasterDetail, PhoneSheet, Sheet, motion, useUrlSheet, type MasterItem } from "@/components/workspace";
import type { FatigueThresholds } from "@/lib/marketing/fatigue";
import type { InsightAd } from "@/lib/creative/insights";
import { TAG_LABEL, TAG_TYPES, TAG_VOCAB, type TagType, type WinnerSettings, type WinnersResult } from "@/lib/creative/winners";
import { formatCount, formatMoney, formatPercent } from "@/lib/marketing/view-model";

import { saveThresholdsAction, setTagAction, confirmTagsAction, suggestTagsAction } from "./creative-actions";
import { Labelled, StatusLine, fieldClass, tagLabel, useAction } from "./creative-ui";

const FATIGUE_CHIP = { ok: { label: "Healthy", variant: "success" }, watch: { label: "Watch", variant: "warning" }, fatigued: { label: "Tired", variant: "destructive" }, insufficient: { label: "Too early", variant: "outline" } } as const;
const CHANNEL = { meta: "Meta", google: "Google" } as Record<string, string>;
const dash = (v: number | null, f: (n: number) => string) => (v === null ? "Not available" : f(v));

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium tabular-nums">{value}</dd>
      {hint && <p className="text-[11px] leading-tight text-muted-foreground">{hint}</p>}
    </div>
  );
}

function TagEditor({ ad }: { ad: InsightAd }) {
  const { run, pending, message } = useAction();
  const hasDraft = ad.tagStatus === "DRAFT" && Object.keys(ad.tags).length > 0;
  return (
    <section aria-labelledby={`tags-${ad.key}`} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`tags-${ad.key}`} className="font-heading text-sm font-semibold">Tags</h3>
        {hasDraft && <Badge variant="warning">Some tags are drafts</Badge>}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {TAG_TYPES.map((type) => (
          <Labelled key={type} label={TAG_LABEL[type]} htmlFor={`tag-${ad.key}-${type}`}>
            <select
              id={`tag-${ad.key}-${type}`}
              className={fieldClass}
              disabled={pending}
              value={ad.tags[type] ?? ""}
              onChange={(e) => run(() => setTagAction({ channel: ad.channel, adId: ad.adId, adName: ad.adName, type, value: e.target.value }), "Tag saved.")}
            >
              <option value="">Not set</option>
              {TAG_VOCAB[type].map((v) => (
                <option key={v} value={v}>{tagLabel(v)}</option>
              ))}
            </select>
            {ad.tagSources[type] && ad.tagSources[type] !== "HUMAN" && <p className="text-[11px] text-muted-foreground">Suggested by {ad.tagSources[type] === "AI" ? "the AI draft" : "a rule"}: confirm it to use it.</p>}
          </Labelled>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {hasDraft && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => confirmTagsAction(ad.key), "Draft tags confirmed.")}>
            Confirm draft tags
          </Button>
        )}
        <StatusLine message={message} />
      </div>
    </section>
  );
}

function FatigueBlock({ ad }: { ad: InsightAd }) {
  const f = ad.fatigue;
  if (!f) return <p className="text-sm text-muted-foreground">No day-by-day delivery is stored for this ad, so fatigue cannot be judged.</p>;
  const chip = FATIGUE_CHIP[f.status];
  return (
    <section aria-label="Fatigue" className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <h3 className="font-heading text-sm font-semibold">Fatigue</h3>
        <Badge variant={chip.variant}>{chip.label}</Badge>
      </div>
      {f.signals.length > 0 ? (
        <ul className="list-disc pl-5 text-sm">
          {f.signals.map((s) => (
            <li key={s.kind}>{s.message}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{f.note ?? "No sign of fatigue: click-through, cost per lead and frequency are steady."}</p>
      )}
      {f.frequency.state === "not_reported" && f.status !== "insufficient" && <p className="text-xs text-muted-foreground">Frequency is not reported for this ad, so it was not judged.</p>}
    </section>
  );
}

function Detail({ ad }: { ad: InsightAd }) {
  const money = (n: number) => formatMoney(n, ad.currency);
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div>
        <p className="font-heading text-base font-semibold">{ad.adName}</p>
        <p className="text-muted-foreground">{CHANNEL[ad.channel] ?? ad.channel} · {ad.campaignName}{ad.format ? ` · ${ad.format.replace(/_/g, " ").toLowerCase()}` : ""}</p>
      </div>
      {ad.outcomes === "platform_only" && <p role="note" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">Platform numbers only. The CRM cannot say which of its customers came from this ad, because leads do not carry an ad id.</p>}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
        <Stat label="Spend" value={dash(ad.spend, money)} />
        <Stat label="Impressions" value={dash(ad.impressions, formatCount)} />
        <Stat label="Click-through" value={ad.impressions ? formatPercent((ad.clicks ?? 0) / ad.impressions) : "Not available"} />
        <Stat label="Leads (platform)" value={dash(ad.platformLeads, formatCount)} />
        <Stat label="Leads (CRM)" value={dash(ad.leads, formatCount)} />
        <Stat label="Funded customers" value={dash(ad.funded, formatCount)} />
        <Stat label="Cost per funded" value={ad.costPerFunded === null ? (ad.funded === 0 ? "No funded yet" : "Not available") : money(ad.costPerFunded)} />
        <Stat label="Revenue booked" value={dash(ad.revenue, money)} />
      </dl>
      <FatigueBlock ad={ad} />
      <TagEditor ad={ad} />
    </div>
  );
}

function WinnersCard({ winners, ads }: { winners: WinnersResult; ads: InsightAd[] }) {
  const name = (key: string) => ads.find((a) => a.key === key)?.adName ?? key;
  return (
    <div className={`${motion.enter} flex flex-col gap-2 rounded-xl border border-border bg-card p-3 text-sm`}>
      {winners.state === "not_enough_data" ? (
        <p><strong className="font-medium">Not enough data yet.</strong> {winners.reason}</p>
      ) : winners.shared.length === 0 ? (
        <p>The {winners.winners.length} cheapest creatives per funded customer do not share a tag that the rest lack. Keep tagging, and check again as more customers fund.</p>
      ) : (
        <>
          <p>
            The {winners.winners.length} cheapest creatives per funded customer ({winners.winners.map((w) => name(w.key)).join(", ")}) share:
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {winners.shared.map((s) => (
              <li key={`${s.type}:${s.value}`}>
                <Badge variant="success">{TAG_LABEL[s.type]}: {tagLabel(s.value)} <span className="font-normal">({s.winnersWith} of {s.winnersTotal}; {s.othersWith} of {s.othersTotal} others)</span></Badge>
              </li>
            ))}
          </ul>
          {winners.usesDraftTags && <p className="text-xs text-warning">Some of these tags are drafts nobody has confirmed yet.</p>}
          <p className="text-xs text-muted-foreground">A pattern in a small number of creatives is a clue, not proof. Test it in the Experiments tab before changing budgets.</p>
        </>
      )}
    </div>
  );
}

const num = (v: string) => Number(v);

function ThresholdsForm({ fatigue, winners }: { fatigue: FatigueThresholds; winners: WinnerSettings }) {
  const { run, pending, message } = useAction();
  const [f, setF] = useState(fatigue);
  const [w, setW] = useState(winners);
  const set = <T extends object>(s: T, setS: (v: T) => void, k: keyof T) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: num(e.target.value) });
  const n = (id: string, label: string, value: number, onChange: (e: React.ChangeEvent<HTMLInputElement>) => void, step = 1) => (
    <Labelled label={label} htmlFor={id}>
      <input id={id} type="number" step={step} className={fieldClass} value={value} onChange={onChange} />
    </Labelled>
  );
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveThresholdsAction("fatigue", f), "Fatigue thresholds saved.", () => run(() => saveThresholdsAction("winners", w), "Thresholds saved."));
      }}
    >
      <p className="text-xs text-muted-foreground">These are defaults chosen to be cautious, not industry facts. Change them to suit your account; every ad is judged on the new values straight away.</p>
      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="mb-1 font-heading text-sm font-semibold">Fatigue</legend>
        {n("th-freq", "Frequency at or above", f.frequency, set(f, setF, "frequency"), 0.1)}
        {n("th-ctr", "Click-through drop, %", f.ctrDecayPct, set(f, setF, "ctrDecayPct"))}
        {n("th-cpl", "Cost per lead rise, %", f.cplDriftPct, set(f, setF, "cplDriftPct"))}
        {n("th-win", "Days in each window", f.windowDays, set(f, setF, "windowDays"))}
        {n("th-min", "Fewest days before judging", f.minDays, set(f, setF, "minDays"))}
        {n("th-imp", "Fewest impressions per window", f.minImpressions, set(f, setF, "minImpressions"))}
        {n("th-leads", "Fewest leads per window", f.minLeads, set(f, setF, "minLeads"))}
      </fieldset>
      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="mb-1 font-heading text-sm font-semibold">What the winners share</legend>
        {n("w-creatives", "Fewest creatives", w.minCreatives, set(w, setW, "minCreatives"))}
        {n("w-funded", "Fewest funded customers", w.minFundedTotal, set(w, setW, "minFundedTotal"))}
        {n("w-per", "Funded per winner", w.minFundedPerWinner, set(w, setW, "minFundedPerWinner"))}
        {n("w-lift", "Lift over the rest, points", w.liftPoints, set(w, setW, "liftPoints"))}
      </fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>Save thresholds</Button>
        <StatusLine message={message} />
      </div>
    </form>
  );
}

export function InsightsView({ ads, winners, fatigue, winnerSettings }: { ads: InsightAd[]; winners: WinnersResult; fatigue: FatigueThresholds; winnerSettings: WinnerSettings }) {
  const { run, pending, message } = useAction();
  const sheet = useUrlSheet("thresholds");
  const items: MasterItem[] = ads.map((a) => {
    const chip = a.fatigue ? FATIGUE_CHIP[a.fatigue.status] : null;
    return {
      id: a.key,
      title: a.adName,
      meta: `${CHANNEL[a.channel] ?? a.channel} · ${a.funded === null ? "platform numbers only" : `${a.funded} funded`}`,
      trailing: chip ? <Badge variant={chip.variant}>{chip.label}</Badge> : undefined,
    };
  });
  const details = Object.fromEntries(ads.map((a) => [a.key, <Detail key={a.key} ad={a} />]));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PhoneSheet name="winners" title="What the winners share" summary={winners.state === "ok" ? `${winners.shared.length} shared tags` : "Not enough data yet"}>
        <WinnersCard winners={winners} ads={ads} />
      </PhoneSheet>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={pending || ads.length === 0} onClick={() => run(() => suggestTagsAction(ads.slice(0, 40).map((a) => ({ channel: a.channel, adId: a.adId, adName: a.adName, format: a.format }))), "Draft tags added.")}>
          <Sparkles aria-hidden className="size-4" /> Suggest draft tags
        </Button>
        <Button size="sm" variant="ghost" onClick={sheet.show} aria-haspopup="dialog">
          <Settings2 aria-hidden className="size-4" /> Thresholds
        </Button>
        <StatusLine message={message} />
      </div>
      <Sheet name="thresholds" open={sheet.open} onClose={sheet.hide} title="Fatigue and winner thresholds">
        <ThresholdsForm fatigue={fatigue} winners={winnerSettings} />
      </Sheet>
      {ads.length === 0 ? <p className="text-sm text-muted-foreground">No ad-level data in this range.</p> : <MasterDetail idPrefix="insights" label="Ads" items={items} details={details} noun="ads" />}
    </div>
  );
}

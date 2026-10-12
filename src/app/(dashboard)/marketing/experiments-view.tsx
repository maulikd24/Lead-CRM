"use client";

import { useMemo, useState } from "react";
import { FlaskConical } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MasterDetail, PhoneSheet, Sheet, motion, useUrlSheet, type MasterItem } from "@/components/workspace";
import { EXPERIMENT_DECISIONS, guideSampleSize, planDecision, type ExperimentDecision, type ExperimentStatus } from "@/lib/creative/experiments";
import type { ExperimentView, ExperimentsData } from "@/lib/creative/experiments-view";

import { deleteExperimentAction, saveExperimentAction } from "./creative-actions";
import { Labelled, StatusLine, areaClass, fieldClass, useAction } from "./creative-ui";

const STATUS_LABEL: Record<ExperimentStatus, string> = { PLANNED: "Planned", RUNNING: "Running", DECIDED: "Decided" };
const DECISION_LABEL: Record<ExperimentDecision, string> = { ADOPT: "Adopt the change", KEEP_CONTROL: "Keep the control", INCONCLUSIVE: "Inconclusive", STOPPED: "Stopped early" };
const METRICS = ["funded_rate", "lead_rate", "kyc_rate", "click_rate", "other"] as const;
const METRIC_LABEL: Record<string, string> = { funded_rate: "Lead to funded rate", lead_rate: "Click to lead rate", kyc_rate: "Lead to KYC rate", click_rate: "Impression to click rate", other: "Other" };

/** The sample-size guide: how many people a test needs and how long that takes at the stated volume. Shown live. */
function Guide({ baselinePct, mde, mdeKind, perDay }: { baselinePct: string; mde: string; mdeKind: "absolute" | "relative"; perDay: string }) {
  const baseline = Number(baselinePct) / 100;
  const g = baselinePct !== "" && mde !== "" ? guideSampleSize({ baselineRate: baseline, mde: mdeKind === "absolute" ? Number(mde) / 100 : Number(mde) / 100, mdeKind, visitorsPerDay: perDay ? Number(perDay) : undefined }) : null;
  if (!g) return <p className="text-xs text-muted-foreground">Enter your current rate and the smallest lift worth acting on to see how big a test you need.</p>;
  if (!g.ok) return <p role="alert" className="text-xs text-destructive">{g.error}</p>;
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/30 p-2.5 text-xs" aria-live="polite">
      <p><strong className="font-medium">{g.perArm.toLocaleString("en-IN")} people per arm</strong> ({g.total.toLocaleString("en-IN")} in all) at 5% significance and 80% power.</p>
      {g.days !== null && <p>At {Number(perDay).toLocaleString("en-IN")} people a day that is about <strong className="font-medium">{g.days} days</strong>{g.realistic ? "." : ", which is longer than 8 weeks."}</p>}
      {g.detectableIn28Days && <p>In 4 weeks at this volume the smallest lift you could detect is about {(g.detectableIn28Days.relative * 100).toFixed(0)}% of your current rate.</p>}
      {g.detectableIn28Days === null && g.days !== null && <p>At this volume, no realistic lift is detectable in 4 weeks.</p>}
      {g.advice.map((a) => <p key={a} className="text-muted-foreground">{a}</p>)}
    </div>
  );
}

function ResultReader() {
  const [a, setA] = useState({ v: "", c: "" });
  const [b, setB] = useState({ v: "", c: "" });
  const r = a.v && a.c && b.v && b.c ? planDecision({ a: { visitors: Number(a.v), conversions: Number(a.c) }, b: { visitors: Number(b.v), conversions: Number(b.c) } }) : null;
  const num = (id: string, label: string, v: string, set: (s: string) => void) => <Labelled label={label} htmlFor={id}><input id={id} inputMode="numeric" className={fieldClass} value={v} onChange={(e) => set(e.target.value)} /></Labelled>;
  return (
    <section aria-label="Read a finished test" className="flex flex-col gap-2">
      <h2 className="font-heading text-sm font-semibold">Read a finished test</h2>
      <div className="grid grid-cols-2 gap-2">
        {num("ra-v", "A: people", a.v, (v) => setA({ ...a, v }))}{num("rb-v", "B: people", b.v, (v) => setB({ ...b, v }))}
        {num("ra-c", "A: converted", a.c, (c) => setA({ ...a, c }))}{num("rb-c", "B: converted", b.c, (c) => setB({ ...b, c }))}
      </div>
      {r && <p role="status" className="rounded-md border border-border p-2 text-xs">{r.message}</p>}
    </section>
  );
}

function ExperimentForm({ exp, data, onDone }: { exp: ExperimentView | null; data: ExperimentsData; onDone: () => void }) {
  const { run, pending, message } = useAction();
  const [name, setName] = useState(exp?.name ?? "");
  const [hypothesis, setHypothesis] = useState(exp?.hypothesis ?? "");
  const [metric, setMetric] = useState(exp?.metric ?? "funded_rate");
  const [baseline, setBaseline] = useState(exp?.baselineRate != null ? String(+(exp.baselineRate * 100).toFixed(2)) : data.observed && data.observed.rate !== null && data.observed.funded > 0 ? String(+(data.observed.rate * 100).toFixed(1)) : "");
  const [mde, setMde] = useState(exp?.mde != null ? String(+(exp.mde * 100).toFixed(2)) : "");
  const [mdeKind, setMdeKind] = useState<"absolute" | "relative">(exp?.mdeKind ?? "relative");
  const [perDay, setPerDay] = useState(exp?.visitorsPerDay != null ? String(exp.visitorsPerDay) : "");
  const [startAt, setStartAt] = useState(exp?.startAt ?? "");
  const [endAt, setEndAt] = useState(exp?.endAt ?? "");
  const [status, setStatus] = useState<ExperimentStatus>(exp?.status ?? "PLANNED");
  const [decision, setDecision] = useState<ExperimentDecision | "">(exp?.decision ?? "");
  const [learning, setLearning] = useState(exp?.learning ?? "");
  const [campaignIds, setCampaignIds] = useState<string[]>(exp?.campaignIds ?? []);
  const toggle = (id: string) => setCampaignIds(campaignIds.includes(id) ? campaignIds.filter((x) => x !== id) : [...campaignIds, id]);
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => {
      e.preventDefault();
      run(() => saveExperimentAction(exp?.id ?? null, { name, hypothesis, metric, baselineRate: baseline === "" ? null : Number(baseline) / 100, mde: mde === "" ? null : Number(mde) / 100, mdeKind, visitorsPerDay: perDay === "" ? null : Number(perDay), startAt: startAt || null, endAt: endAt || null, status, decision: decision || null, learning: learning || null, campaignIds }), "Experiment saved.", onDone);
    }}>
      <Labelled label="Name" htmlFor="ex-name"><input id="ex-name" className={fieldClass} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></Labelled>
      <Labelled label="Hypothesis" hint="What you expect to happen, and why." htmlFor="ex-hyp"><textarea id="ex-hyp" rows={2} className={areaClass} required value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} /></Labelled>
      <Labelled label="Metric that decides it" htmlFor="ex-metric">
        <select id="ex-metric" className={fieldClass} value={metric} onChange={(e) => setMetric(e.target.value)}>{METRICS.map((m) => <option key={m} value={m}>{METRIC_LABEL[m]}</option>)}{!METRICS.includes(metric as never) && <option value={metric}>{metric}</option>}</select>
      </Labelled>
      <div className="grid grid-cols-2 gap-2">
        <Labelled label="Current rate, %" hint={data.observed ? `Last ${data.observed.windowDays} days: ${data.observed.funded} funded of ${data.observed.leads} leads` : "Not enough synced data to suggest one."} htmlFor="ex-base"><input id="ex-base" inputMode="decimal" className={fieldClass} value={baseline} onChange={(e) => setBaseline(e.target.value)} /></Labelled>
        <Labelled label="Smallest lift worth acting on, %" htmlFor="ex-mde"><input id="ex-mde" inputMode="decimal" className={fieldClass} value={mde} onChange={(e) => setMde(e.target.value)} /></Labelled>
        <Labelled label="The lift is" htmlFor="ex-kind"><select id="ex-kind" className={fieldClass} value={mdeKind} onChange={(e) => setMdeKind(e.target.value as "absolute" | "relative")}><option value="relative">Relative (a share of the current rate)</option><option value="absolute">Absolute (percentage points)</option></select></Labelled>
        <Labelled label="People entering per day" htmlFor="ex-vol"><input id="ex-vol" inputMode="numeric" className={fieldClass} value={perDay} onChange={(e) => setPerDay(e.target.value)} /></Labelled>
      </div>
      <Guide baselinePct={baseline} mde={mde} mdeKind={mdeKind} perDay={perDay} />
      <div className="grid grid-cols-2 gap-2">
        <Labelled label="Start" htmlFor="ex-start"><input id="ex-start" type="date" className={fieldClass} value={startAt} onChange={(e) => setStartAt(e.target.value)} /></Labelled>
        <Labelled label="End" htmlFor="ex-end"><input id="ex-end" type="date" className={fieldClass} value={endAt} onChange={(e) => setEndAt(e.target.value)} /></Labelled>
        <Labelled label="Status" htmlFor="ex-status"><select id="ex-status" className={fieldClass} value={status} onChange={(e) => setStatus(e.target.value as ExperimentStatus)}>{(Object.keys(STATUS_LABEL) as ExperimentStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></Labelled>
        <Labelled label="Decision" htmlFor="ex-dec"><select id="ex-dec" className={fieldClass} value={decision} onChange={(e) => setDecision(e.target.value as ExperimentDecision | "")}><option value="">Not decided</option>{EXPERIMENT_DECISIONS.map((d) => <option key={d} value={d}>{DECISION_LABEL[d]}</option>)}</select></Labelled>
      </div>
      <Labelled label="What you learned" htmlFor="ex-learn"><textarea id="ex-learn" rows={3} className={areaClass} value={learning} onChange={(e) => setLearning(e.target.value)} /></Labelled>
      {data.campaigns.length > 0 && (
        <fieldset className="flex max-h-40 flex-col gap-1 overflow-y-auto">
          <legend className="mb-1 text-xs font-medium text-muted-foreground">Linked campaigns</legend>
          {data.campaigns.map((c) => <label key={c.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={campaignIds.includes(c.id)} onChange={() => toggle(c.id)} /> {c.name}</label>)}
        </fieldset>
      )}
      <div className="flex items-center gap-3"><Button type="submit" size="sm" disabled={pending}>Save experiment</Button><StatusLine message={message} /></div>
    </form>
  );
}

function Detail({ exp, data, onEdit }: { exp: ExperimentView; data: ExperimentsData; onEdit: () => void }) {
  const { run, pending, message } = useAction();
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><p className="font-heading text-base font-semibold">{exp.name}</p><p className="text-muted-foreground">{METRIC_LABEL[exp.metric] ?? exp.metric}</p></div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={exp.status === "DECIDED" ? "success" : exp.status === "RUNNING" ? "warning" : "outline"}>{STATUS_LABEL[exp.status]}</Badge>
          <Button size="sm" variant="outline" onClick={onEdit}>Edit</Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => confirm("Delete this experiment?") && run(() => deleteExperimentAction(exp.id), "Deleted.")}>Delete</Button>
        </div>
      </div>
      <div><p className="text-xs text-muted-foreground">Hypothesis</p><p>{exp.hypothesis}</p></div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {([
          ["Current rate", exp.baselineRate != null ? `${+(exp.baselineRate * 100).toFixed(2)}%` : "Not set"],
          ["Smallest lift", exp.mde != null ? `${+(exp.mde * 100).toFixed(2)}${exp.mdeKind === "relative" ? "% of the rate" : " points"}` : "Not set"],
          ["People per arm", exp.sampleSizePerArm != null ? exp.sampleSizePerArm.toLocaleString("en-IN") : "Not calculated"],
          ["Started", exp.startAt ?? "Not started"],
          ["Ended", exp.endAt ?? "Open"],
          ["Decision", exp.decision ? DECISION_LABEL[exp.decision] : "Not decided"],
        ] as const).map(([k, v]) => <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium tabular-nums">{v}</dd></div>)}
      </dl>
      {exp.learning && <div><p className="text-xs text-muted-foreground">Learning</p><p>{exp.learning}</p></div>}
      {exp.campaignIds.length > 0 && <div><p className="text-xs text-muted-foreground">Linked campaigns</p><ul className="flex flex-wrap gap-1.5">{exp.campaignIds.map((id) => <li key={id}><Badge variant="secondary">{data.names[id] ?? id}</Badge></li>)}</ul></div>}
      <StatusLine message={message} />
    </div>
  );
}

export function ExperimentsView({ data }: { data: ExperimentsData }) {
  const sheet = useUrlSheet("experiment");
  const [editing, setEditing] = useState<ExperimentView | null>(null);
  const items: MasterItem[] = data.experiments.map((e) => ({ id: e.id, title: e.name, meta: e.startAt ? `${e.startAt}${e.endAt ? ` to ${e.endAt}` : ""}` : "No dates yet", trailing: <Badge variant={e.status === "DECIDED" ? "success" : e.status === "RUNNING" ? "warning" : "outline"}>{STATUS_LABEL[e.status]}</Badge> }));
  const details = useMemo(() => Object.fromEntries(data.experiments.map((e) => [e.id, <Detail key={e.id} exp={e} data={data} onEdit={() => { setEditing(e); sheet.show(); }} />])), [data, sheet]);
  return (
    <div className={`${motion.enter} flex min-h-0 flex-1 flex-col gap-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => { setEditing(null); sheet.show(); }} aria-haspopup="dialog"><FlaskConical aria-hidden className="size-4" /> New experiment</Button>
      </div>
      <PhoneSheet name="reader" title="Read a finished test" summary="Is the difference real?"><ResultReader /></PhoneSheet>
      <Sheet name="experiment" open={sheet.open} onClose={sheet.hide} title={editing ? "Edit experiment" : "New experiment"}>
        <ExperimentForm key={editing?.id ?? "new"} exp={editing} data={data} onDone={sheet.hide} />
      </Sheet>
      {data.experiments.length === 0 ? <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">No experiments yet. Write down a hypothesis before you change an ad: what you expect, how you will measure it, and how big the difference must be to matter.</p> : <MasterDetail idPrefix="experiments" label="Experiments" items={items} details={details} noun="experiments" />}
    </div>
  );
}

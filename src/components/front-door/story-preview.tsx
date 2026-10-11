"use client";

import { ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { KpiStrip, KpiTile } from "@/components/workspace/kpi-strip";
import { RailCard } from "@/components/workspace/sticky-rail";
import { STORY_DATA, type StoryView } from "@/lib/front-door/fixtures";

import { BrowserFrame } from "./browser-frame";

const D = STORY_DATA;

const URLS: Record<StoryView, string> = {
  know: "customer-os / customers / rahul-m",
  hold: "customer-os / customers / rahul-m / next steps",
  decide: "customer-os / customers / rahul-m / next steps",
  brief: "customer-os / customers / rahul-m / call brief",
  call: "customer-os / calls / review",
  remember: "customer-os / customers / rahul-m / memory",
};

function Header({ extra }: { extra?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h4>{D.customer.name}</h4>
      <Badge variant="secondary">{D.customer.segment}</Badge>
      {extra && <Badge variant="warning">{extra}</Badge>}
    </div>
  );
}

function Know() {
  return (
    <div className="fd-screen">
      <Header extra="Complaint open" />
      <KpiStrip label="Key facts about Rahul">
        {D.facts.map((f, i) => (
          <KpiTile key={f.label} label={f.label} tone={"tone" in f ? f.tone : "default"} hint={f.hint} index={i}>
            {f.value}
          </KpiTile>
        ))}
      </KpiStrip>
      <div className="grid gap-2" role="list" aria-label="Recent signals">
        {D.signals.map((s) => (
          <div key={s.text} className="fd-row" role="listitem">
            <span>
              <b>{s.text}</b>
              <small>{s.when}</small>
            </span>
            <Badge variant="outline">{s.chip}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

function Candidates({ chosen }: { chosen: boolean }) {
  return (
    <div className="grid gap-2" role="list" aria-label="Candidate next steps">
      {D.candidates.map((c) => {
        const state = c.state === "chosen" && !chosen ? "weighing" : c.state;
        return (
          <div key={c.action} className="fd-row" data-state={state} role="listitem">
            <span>
              <b>{c.action}</b>
              <small>{state === "weighing" ? "Being weighed against the other two." : c.reason}</small>
            </span>
            {state === "held" ? <Badge variant="secondary">Held back</Badge> : state === "chosen" ? <Badge>Chosen</Badge> : <Badge variant="outline">Candidate</Badge>}
          </div>
        );
      })}
    </div>
  );
}

function Hold() {
  return (
    <div className="fd-screen">
      <Header extra="Complaint open" />
      <h5 className="m-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Next steps in line</h5>
      <Candidates chosen={false} />
      <p className="m-0 text-xs text-muted-foreground">Held back means: not drafted, not sent, and the reason is written down.</p>
    </div>
  );
}

function Decide() {
  return (
    <div className="fd-screen">
      <Header extra="Complaint open" />
      <div className="fd-two">
        <Candidates chosen />
        <aside className="fd-drawer" aria-label="Evidence">
          <div className="fd-drawer-head">
            <span>Evidence</span>
            <Badge variant="outline">4 sources</Badge>
          </div>
          <ul>
            {D.evidence.map((e) => (
              <li key={e.source}>
                <b>{e.source}</b>
                {e.detail}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

function Brief() {
  return (
    <div className="fd-screen">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Header />
        <Badge variant="accent">AI draft</Badge>
      </div>
      <RailCard title={D.brief.headline} labelId="fd-brief-title" index={0}>
        <div className="fd-two text-sm">
          <div>
            <p className="m-0 mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Say</p>
            <ul className="m-0 grid list-disc gap-1 pl-4">{D.brief.say.map((t) => <li key={t}>{t}</li>)}</ul>
          </div>
          <div>
            <p className="m-0 mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Leave out</p>
            <ul className="m-0 grid list-disc gap-1 pl-4">{D.brief.avoid.map((t) => <li key={t}>{t}</li>)}</ul>
          </div>
        </div>
      </RailCard>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-xs text-muted-foreground">{D.brief.note}</p>
        <div className="fd-chips" aria-hidden="true">
          <span className="fd-pillbtn">Edit</span>
          <span className="fd-pillbtn" data-primary="true">Approve</span>
        </div>
      </div>
    </div>
  );
}

function Call() {
  return (
    <div className="fd-screen">
      <div className="flex flex-wrap items-center gap-2">
        <h4>{D.call.title}</h4>
        <Badge variant="outline">Rahul M.</Badge>
      </div>
      <KpiStrip label="Call outcomes">
        {D.call.outcomes.map((o, i) => (
          <KpiTile key={o.label} label={o.label} tone={o.tone} index={i}>
            {o.value}
          </KpiTile>
        ))}
      </KpiStrip>
      <p className="m-0 text-sm">{D.call.summary}</p>
      <div className="grid gap-2" role="list" aria-label="Moments from the call">
        {D.call.moments.map((m) => (
          <div key={m.at} className="fd-row" role="listitem">
            <span>{m.text}</span>
            <Badge variant="secondary">{m.at}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

function Remember() {
  return (
    <div className="fd-screen">
      <div className="flex flex-wrap items-center gap-2">
        <h4>Memory updated</h4>
        <Badge variant="success">Complaint closed</Badge>
      </div>
      <div className="grid gap-2" role="list" aria-label="What changed in memory">
        {D.memory.map((m) => (
          <div key={m.label} className="fd-row" role="listitem">
            <b>{m.label}</b>
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              {m.before}
              <ArrowRight className="size-3.5" aria-hidden="true" />
              <span className="font-semibold text-foreground">{m.after}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="fd-row" data-state="chosen">
        <span>
          <b>{D.nextDecision.action}</b>
          <small>{D.nextDecision.detail}</small>
        </span>
        <Badge variant="warning">{D.nextDecision.state}</Badge>
      </div>
    </div>
  );
}

const SCREENS: Record<StoryView, () => React.JSX.Element> = { know: Know, hold: Hold, decide: Decide, brief: Brief, call: Call, remember: Remember };

/** The sticky product preview. Built from the real workspace components (KPI tiles, chips, rail card, evidence drawer look) with synthetic data. */
export default function StoryPreview({ view }: { view: StoryView }) {
  const Screen = SCREENS[view];
  return (
    <BrowserFrame url={URLS[view]} label="Product preview with synthetic example data">
      <div key={view}>
        <Screen />
      </div>
    </BrowserFrame>
  );
}

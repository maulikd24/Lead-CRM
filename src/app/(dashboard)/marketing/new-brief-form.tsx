"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { AD_FORMATS, FORMAT_KEYS, type FormatKey } from "@/lib/creative/formats";
import { HOOK_LABEL, HOOK_TYPES } from "@/lib/creative/kit";
import type { ReferenceView } from "@/lib/creative/briefs-db";
import { referenceSummary, MAX_REFERENCES } from "@/lib/creative/competitor";

import { createBriefAction } from "./creative-actions";
import { Labelled, StatusLine, fieldClass, useAction } from "./creative-ui";

/** One brief becomes a master hook, USP and call to action plus a variant per channel. Templates always work; the AI path needs its switch on. */
export function NewBriefForm({ aiOn, references, today, onCreated }: { aiOn: boolean; references: ReferenceView[]; today: string; onCreated: (briefId: string) => void }) {
  const { run, pending, message } = useAction();
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState("First-time investors");
  const [language, setLanguage] = useState<"en" | "hinglish">("en");
  const [hookType, setHookType] = useState<(typeof HOOK_TYPES)[number]>("question");
  const [usp, setUsp] = useState("");
  const [cta, setCta] = useState("");
  const [formats, setFormats] = useState<FormatKey[]>(["meta_feed", "google_rsa"]);
  const [mode, setMode] = useState<"templates" | "ai">("templates");
  const [refs, setRefs] = useState<string[]>([]);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => createBriefAction({ title, topic, audience, language, hookType, usp: usp || undefined, cta: cta || undefined, formats }, mode, refs), "Brief created.", (r) => onCreated(r.briefId));
      }}
    >
      <p className="text-xs text-muted-foreground">Describe a process or a concept to explain, never a product to push. Every draft is checked against the firm&apos;s compliance rules and needs a person to approve it.</p>
      <Labelled label="Brief name" htmlFor="nb-title"><input id="nb-title" className={fieldClass} required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} /></Labelled>
      <Labelled label="What the ad explains" hint="For example: opening a demat account" htmlFor="nb-topic"><input id="nb-topic" className={fieldClass} required maxLength={120} value={topic} onChange={(e) => setTopic(e.target.value)} /></Labelled>
      <Labelled label="Audience" htmlFor="nb-aud"><input id="nb-aud" className={fieldClass} required maxLength={200} value={audience} onChange={(e) => setAudience(e.target.value)} /></Labelled>
      <div className="grid grid-cols-2 gap-2">
        <Labelled label="Language" htmlFor="nb-lang">
          <select id="nb-lang" className={fieldClass} value={language} onChange={(e) => setLanguage(e.target.value as "en" | "hinglish")}>
            <option value="en">English</option>
            <option value="hinglish">Hinglish</option>
          </select>
        </Labelled>
        <Labelled label="Hook style" htmlFor="nb-hook">
          <select id="nb-hook" className={fieldClass} value={hookType} onChange={(e) => setHookType(e.target.value as (typeof HOOK_TYPES)[number])}>
            {HOOK_TYPES.map((h) => <option key={h} value={h}>{HOOK_LABEL[h]}</option>)}
          </select>
        </Labelled>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Labelled label="One-line USP (optional)" htmlFor="nb-usp"><input id="nb-usp" className={fieldClass} maxLength={140} value={usp} onChange={(e) => setUsp(e.target.value)} /></Labelled>
        <Labelled label="Call to action (optional)" htmlFor="nb-cta"><input id="nb-cta" className={fieldClass} maxLength={60} placeholder="Book a 15-minute call" value={cta} onChange={(e) => setCta(e.target.value)} /></Labelled>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs font-medium text-muted-foreground">Channels</legend>
        {FORMAT_KEYS.map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={formats.includes(k)} onChange={() => setFormats(toggle(formats, k))} /> {AD_FORMATS[k].label}</label>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs font-medium text-muted-foreground">How to draft</legend>
        <label className="flex items-center gap-2 text-sm"><input type="radio" name="nb-mode" checked={mode === "templates"} onChange={() => setMode("templates")} /> Playbook templates (always available)</label>
        <label className={`flex items-center gap-2 text-sm ${aiOn ? "" : "text-muted-foreground"}`}><input type="radio" name="nb-mode" disabled={!aiOn} checked={mode === "ai"} onChange={() => setMode("ai")} /> AI draft{aiOn ? "" : " (switched off)"}</label>
      </fieldset>
      {references.length > 0 && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-xs font-medium text-muted-foreground">Competitor references (inspiration only, up to {MAX_REFERENCES})</legend>
          {references.slice(0, 20).map((r) => (
            <label key={r.id} className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={refs.includes(r.id)} disabled={!refs.includes(r.id) && refs.length >= MAX_REFERENCES} onChange={() => setRefs(toggle(refs, r.id))} /> <span><strong className="font-medium">{r.competitor}</strong>: {referenceSummary(r, today)}</span></label>
          ))}
        </fieldset>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending || formats.length === 0}>{pending ? "Drafting…" : "Create brief and drafts"}</Button>
        <StatusLine message={message} />
      </div>
    </form>
  );
}

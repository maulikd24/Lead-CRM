"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { BrandProfile } from "@/lib/creative/brand";

import { saveBrandProfileAction } from "./creative-actions";
import { Labelled, StatusLine, areaClass, fieldClass, useAction } from "./creative-ui";

const lines = (v: string) => v.split("\n").map((s) => s.trim()).filter(Boolean);
const AUD_HINT = "One per line: key | label | description | en or hinglish";

/** The brand profile as structured context: tone, audiences, regulated claims, banned words and mandatory disclaimers. Saving makes a new version. */
export function BrandForm({ profile, version }: { profile: BrandProfile; version: number }) {
  const { run, pending, message } = useAction();
  const [voice, setVoice] = useState(profile.tone.voice);
  const [dos, setDos] = useState(profile.tone.dos.join("\n"));
  const [donts, setDonts] = useState(profile.tone.donts.join("\n"));
  const [aud, setAud] = useState(profile.audiences.map((a) => `${a.key} | ${a.label} | ${a.description} | ${a.language}`).join("\n"));
  const [claims, setClaims] = useState(profile.regulatedClaims.join("\n"));
  const [banned, setBanned] = useState(profile.bannedWords.join("\n"));
  const [testimonials, setTestimonials] = useState(profile.testimonialsProhibited);
  const [risk, setRisk] = useState(profile.disclaimers.risk);
  const [past, setPast] = useState(profile.disclaimers.pastPerformance);
  const [reg, setReg] = useState(profile.disclaimers.registration);

  function build() {
    return {
      tone: { voice, dos: lines(dos), donts: lines(donts) },
      audiences: lines(aud).map((l) => {
        const [key = "", label = "", description = "", language = "en"] = l.split("|").map((s) => s.trim());
        return { key, label, description, language: language === "hinglish" ? "hinglish" : "en" };
      }),
      regulatedClaims: lines(claims),
      bannedWords: lines(banned),
      testimonialsProhibited: testimonials,
      disclaimers: { risk, pastPerformance: past, registration: reg },
    };
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => saveBrandProfileAction(build()), "Saved as a new version."); }}>
      <p className="text-xs text-muted-foreground">Version {version === 0 ? "0 (built-in defaults, not yet saved)" : version}. Saving creates a new version; an approved ad keeps showing the rules it was checked against. The disclaimer wording must be confirmed by the firm&apos;s compliance officer.</p>
      <Labelled label="Voice" htmlFor="bp-voice"><textarea id="bp-voice" rows={2} className={areaClass} value={voice} onChange={(e) => setVoice(e.target.value)} /></Labelled>
      <Labelled label="Do (one per line)" htmlFor="bp-dos"><textarea id="bp-dos" rows={3} className={areaClass} value={dos} onChange={(e) => setDos(e.target.value)} /></Labelled>
      <Labelled label="Do not (one per line)" htmlFor="bp-donts"><textarea id="bp-donts" rows={3} className={areaClass} value={donts} onChange={(e) => setDonts(e.target.value)} /></Labelled>
      <Labelled label="Audience segments" hint={AUD_HINT} htmlFor="bp-aud"><textarea id="bp-aud" rows={3} className={areaClass} value={aud} onChange={(e) => setAud(e.target.value)} /></Labelled>
      <Labelled label="Regulated claims (one per line)" hint="A claim here may only run with the full risk disclaimer beside it." htmlFor="bp-claims"><textarea id="bp-claims" rows={2} className={areaClass} value={claims} onChange={(e) => setClaims(e.target.value)} /></Labelled>
      <Labelled label="Banned words (one per line)" htmlFor="bp-banned"><textarea id="bp-banned" rows={2} className={areaClass} value={banned} onChange={(e) => setBanned(e.target.value)} /></Labelled>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={testimonials} onChange={(e) => setTestimonials(e.target.checked)} /> Testimonials are prohibited in this firm&apos;s advertising</label>
      <Labelled label="Mandatory risk disclaimer" htmlFor="bp-risk"><textarea id="bp-risk" rows={3} className={areaClass} value={risk} onChange={(e) => setRisk(e.target.value)} /></Labelled>
      <Labelled label="Past-performance disclaimer" htmlFor="bp-past"><input id="bp-past" className={fieldClass} value={past} onChange={(e) => setPast(e.target.value)} /></Labelled>
      <Labelled label="Registration line" hint="Entity name, registration category and number, as the firm supplies them. Left empty it shows as a gap." htmlFor="bp-reg"><textarea id="bp-reg" rows={2} className={areaClass} value={reg} onChange={(e) => setReg(e.target.value)} /></Labelled>
      <div className="flex items-center gap-3"><Button type="submit" size="sm" disabled={pending}>Save as a new version</Button><StatusLine message={message} /></div>
    </form>
  );
}

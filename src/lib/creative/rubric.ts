import { AD_FORMATS, type FieldValues, type FormatKey } from "./formats";
import { checkAdCtaFormula, failedChecks, type RuleResult } from "@/lib/guardrails";

/**
 * The creative scoring rubric. Pure and deterministic: the same copy always scores the same. Six criteria, 100 points.
 * The verdict is scale (run it, make more like it), iterate (promising, fix the weak criteria) or rewrite (start again).
 * A compliance failure overrides any score: the verdict is rewrite and the score is still shown, so the reviewer sees
 * what was good about the copy and why it still cannot run.
 *
 * It judges the WORDS, not how the ad performs: performance comes from the creative intelligence tab. The rubric is a
 * checklist for a first read, not a prediction. Thresholds are defaults and are shown on screen.
 */

export const VERDICT_THRESHOLDS = { scale: 75, iterate: 50 } as const;
export type Verdict = "scale" | "iterate" | "rewrite";
export type Criterion = { id: "clarity" | "hook" | "cta" | "audience_fit" | "risk_clarity" | "specificity"; label: string; points: number; max: number; note: string };
export type RubricResult = { score: number; verdict: Verdict; overridden: boolean; criteria: Criterion[]; reasons: string[] };

const JARGON = /\b(?:alpha|nav|derivatives?|arbitrage|aum|xirr|cagr|irr|hedging|beta|sharpe|alpha\s+generation|duration\s+risk)\b/gi;
const CTA_VERB = /^(?:book|call|talk|request|start|open|download|schedule|check|ask|get|join|explore|compare|learn\s+more|see|read|jaanein|baat\s+karein|\d+\s+minute)/i;

const sentencesOf = (text: string) => text.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function scoreVariant(input: { format: FormatKey; fields: FieldValues; disclaimer: string; language: "en" | "hinglish"; topic: string; compliance: RuleResult }): RubricResult {
  const specs = AD_FORMATS[input.format].fields;
  const values = specs.flatMap((s) => (input.fields[s.key] ?? []).filter((v) => v.trim()).map((v) => ({ key: s.key, value: v.trim() })));
  const copy = values.filter((v) => v.key !== "cta").map((v) => v.value).join("\n");
  const all = values.map((v) => v.value).join("\n");
  const criteria: Criterion[] = [];

  // Clarity: plain words, short sentences.
  const jargon = [...new Set((copy.match(JARGON) ?? []).map((j) => j.toLowerCase()))];
  const sentences = sentencesOf(copy);
  const words = copy.split(/\s+/).filter(Boolean).length;
  const avg = sentences.length ? words / sentences.length : 0;
  let clarity = 20 - jargon.length * 5 - (avg > 20 ? 5 : 0);
  clarity = Math.max(0, clarity);
  criteria.push({ id: "clarity", label: "Clear, plain language", points: clarity, max: 20, note: jargon.length ? `Jargon: ${jargon.join(", ")}.` : avg > 20 ? "Sentences run long." : "Plain words and short sentences." });

  // Hook: a question, a how-it-works promise or a concrete step.
  const hooky = values.some((v) => /\?|^(?:how|why|what|not sure|myth|kya|kaise)\b|\bstep|\bchecklist\b|\bexplained\b/i.test(v.value) && v.key !== "cta");
  criteria.push({ id: "hook", label: "Opens with a clear hook", points: copy ? (hooky ? 20 : 10) : 0, max: 20, note: hooky ? "Opens with a question, a how-it-works promise or a concrete step." : "Nothing in the opening makes the reader want to read on." });

  // One clear call to action.
  const ctaField = (input.fields.cta ?? []).find((v) => v.trim());
  const ctaSentences = new Set(sentencesOf(all).filter((s) => CTA_VERB.test(s) && !/^learn\s+how\b/i.test(s)).map(norm));
  let cta = 5;
  let ctaNote = "No clear call to action.";
  if (ctaField && !checkAdCtaFormula(ctaField).ok) ctaNote = checkAdCtaFormula(ctaField).note;
  else if (ctaSentences.size === 1) {
    cta = 15;
    ctaNote = "One clear next step.";
  } else if (ctaSentences.size === 2) {
    cta = 10;
    ctaNote = "Two calls to action compete; keep one.";
  } else if (ctaSentences.size > 2) ctaNote = "Too many calls to action; keep one.";
  criteria.push({ id: "cta", label: "One clear call to action", points: cta, max: 15, note: ctaNote });

  // Audience fit: speaks about what the audience came to understand.
  const topicWords = input.topic.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4);
  const fits = topicWords.some((w) => copy.toLowerCase().includes(w));
  criteria.push({ id: "audience_fit", label: "Speaks to the audience's question", points: fits ? 15 : 5, max: 15, note: fits ? "Names what the reader wants to understand." : "Does not name the topic the audience cares about." });

  // Risk clarity: the disclosure is there, in the copy a reader sees.
  const riskOk = input.compliance.checks.find((c) => c.id === "risk_disclosure")?.status === "pass";
  criteria.push({ id: "risk_clarity", label: "Risk disclosure in plain words", points: riskOk ? 15 : 0, max: 15, note: riskOk ? "The risk disclosure is present." : "The risk disclosure is missing." });

  // Specificity: a concrete next step or process word instead of a vague promise.
  const specific = /\bsteps?\b|\bchecklist\b|\bdocuments?\b|\bminutes?\b|\bminute\b|\bhow\b.*\bworks?\b|\baasan\b|\bprocess\b|\bcall\b/i.test(copy);
  criteria.push({ id: "specificity", label: "Concrete, not vague", points: specific ? 15 : 5, max: 15, note: specific ? "Names a concrete step or what happens next." : "Stays vague about what the reader gets." });

  const score = criteria.reduce((a, c) => a + c.points, 0);
  const failing = failedChecks(input.compliance);
  const overridden = failing.length > 0;
  const base: Verdict = score >= VERDICT_THRESHOLDS.scale ? "scale" : score >= VERDICT_THRESHOLDS.iterate ? "iterate" : "rewrite";
  const reasons = overridden ? [`Compliance failure overrides the score: ${failing.map((f) => f.label.toLowerCase()).join("; ")}.`] : criteria.filter((c) => c.points < c.max).map((c) => `${c.label}: ${c.note}`);
  return { score, verdict: overridden ? "rewrite" : base, overridden, criteria, reasons };
}

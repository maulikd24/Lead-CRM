import type { ConsentRecordSpec, Decision, EvalCase, Lang } from "../types";

let counters = new Map<string, number>();
/** Test-only: ids are assigned in module load order, so reset is not needed in normal use. */
export function resetIds() { counters = new Map(); }
const nextId = (category: string, lang: Lang) => {
  const key = `${category}.${lang}`;
  const n = (counters.get(key) ?? 0) + 1;
  counters.set(key, n);
  return `${key}.${String(n).padStart(3, "0")}`;
};

type Extra = { note?: string; known?: string };

/** Guardrail cases: each text is run through checkOutbound. */
export function guard(category: string, lang: Lang, expect: Decision, texts: string[], extra: Extra & { code?: "RETURN_PROMISE" | "ADVICE" | "PERFORMANCE_CLAIM" | "PII_ECHO" } = {}): EvalCase[] {
  return texts.map((text) => ({ id: nextId(category, lang), category, lang, expect, kind: "guardrail" as const, text, ...extra })) as EvalCase[];
}

export function handover(category: string, lang: Lang, expect: Decision, texts: string[], extra: Extra = {}): EvalCase[] {
  return texts.map((text) => ({ id: nextId(category, lang), category, lang, expect, kind: "handover" as const, text, ...extra }));
}

/** block: every `sensitive` string must be gone from the vendor-bound text. */
export function redact(category: string, lang: Lang, items: { text: string; sensitive: string[]; known?: string }[]): EvalCase[] {
  return items.map((i) => ({ id: nextId(category, lang), category, lang, expect: "block" as const, kind: "scrub" as const, text: i.text, sensitive: i.sensitive, ...(i.known ? { known: i.known } : {}) }));
}

/** allow: every `keep` string must survive scrubbing. */
export function keep(category: string, lang: Lang, items: { text: string; keep: string[]; known?: string }[]): EvalCase[] {
  return items.map((i) => ({ id: nextId(category, lang), category, lang, expect: "allow" as const, kind: "scrub" as const, text: i.text, keep: i.keep, ...(i.known ? { known: i.known } : {}) }));
}

export function other(category: string, lang: Lang, c: Omit<EvalCase, "id" | "category" | "lang">): EvalCase {
  return { id: nextId(category, lang), category, lang, ...c } as EvalCase;
}

export const rec = (purpose: string, channel: string | null, status: "GRANTED" | "WITHDRAWN", capturedAt: string, expiresAt?: string): ConsentRecordSpec => ({ purpose, channel, status, capturedAt, ...(expiresAt ? { expiresAt } : {}) });

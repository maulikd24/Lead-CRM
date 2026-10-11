/**
 * Competitor ads: a saved list of competitors, ads imported BY HAND or from a CSV, and a way to attach one to a creative
 * brief as a reference. Pure.
 *
 * Owner decision: manual now, swappable provider later. Only the manual/CSV provider exists. Nothing here scrapes a site
 * or calls a vendor. An official source (an ad-library API) or a vendor could implement CompetitorAdsProvider later,
 * after its terms and its coverage of Indian advertisers are checked. We store a pointer to a thumbnail, never the media.
 * A reference is inspiration only: the brief receives tags and facts, never the competitor's words, and a similarity
 * check flags a draft that echoes a reference too closely.
 */

export type ImportedAd = { competitor: string; copy: string; format: string; startDate: string | null; link: string | null; thumbnailRef: string | null };

export interface CompetitorAdsProvider {
  readonly name: string;
  listAds(competitor: { name: string; pageId?: string | null }): Promise<ImportedAd[]>;
}

export function createManualProvider(rows: ImportedAd[]): CompetitorAdsProvider {
  return { name: "manual", async listAds(c) { return rows.filter((r) => r.competitor.trim().toLowerCase() === c.name.trim().toLowerCase()); } };
}

/** The only provider there is. A real one is added by returning it here, once its terms and India coverage are verified. */
export function getCompetitorAdsProvider(): CompetitorAdsProvider {
  return createManualProvider([]);
}

const FORMATS = ["video", "image", "carousel", "text", "other"] as const;
export type CompetitorFormat = (typeof FORMATS)[number];
export const COMPETITOR_FORMATS = FORMATS;

export type CsvError = { line: number; message: string };
export type CsvResult = { rows: ImportedAd[]; errors: CsvError[] };

/** RFC 4180-style records: commas, quotes ("" inside quotes) and line breaks inside quotes. */
function records(text: string): { line: number; cells: string[] }[] {
  const out: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let line = 1;
  let start = 1;
  const push = () => {
    cells.push(cell);
    cell = "";
  };
  const end = () => {
    push();
    if (cells.some((c) => c.trim() !== "")) out.push({ line: start, cells });
    cells = [];
  };
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else { cell += ch; if (ch === "\n") line++; }
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") push();
    else if (ch === "\r") continue;
    else if (ch === "\n") { end(); line++; start = line; }
    else cell += ch;
  }
  if (cell !== "" || cells.length) end();
  return out;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (v: string) => ISO_DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const URL_RE = /^https?:\/\/[^\s]{1,500}$/i;
const OPAQUE_REF = /^[A-Za-z0-9._:/-]{1,200}$/;

export function parseCompetitorCsv(text: string): CsvResult {
  const recs = records(text);
  if (recs.length === 0) return { rows: [], errors: [{ line: 1, message: "The file is empty." }] };
  const header = recs[0].cells.map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  if (col("competitor") < 0 || col("copy") < 0) return { rows: [], errors: [{ line: 1, message: "The header needs at least the columns competitor and copy." }] };
  const rows: ImportedAd[] = [];
  const errors: CsvError[] = [];
  for (const rec of recs.slice(1)) {
    const get = (name: string) => (col(name) >= 0 ? (rec.cells[col(name)] ?? "").trim() : "");
    const fail = (message: string) => errors.push({ line: rec.line, message });
    const competitor = get("competitor");
    const copy = get("copy");
    const format = get("format").toLowerCase();
    const start = get("start_date");
    const link = get("link");
    const thumb = get("thumbnail_ref");
    if (!competitor) { fail("The competitor name is missing."); continue; }
    if (!copy) { fail("The ad copy is missing."); continue; }
    if (copy.length > 3000) { fail("The ad copy is longer than 3,000 characters."); continue; }
    if (start && !validDay(start)) { fail("The start date must look like 2026-09-30."); continue; }
    if (link && !URL_RE.test(link)) { fail("The link must start with http:// or https://."); continue; }
    if (thumb && !(URL_RE.test(thumb) || OPAQUE_REF.test(thumb))) { fail("The thumbnail pointer must be a web address or a short reference, never embedded image data."); continue; }
    rows.push({ competitor, copy, format: (FORMATS as readonly string[]).includes(format) ? format : "other", startDate: start || null, link: link || null, thumbnailRef: thumb || null });
  }
  return { rows, errors };
}

export function daysLive(startDate: string | null, today: string): number | null {
  if (!startDate) return null;
  const d = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000);
  return Math.max(0, d);
}

export function sortByDaysLive<T extends { startDate: string | null }>(ads: T[], today: string): T[] {
  return [...ads].sort((a, b) => (daysLive(b.startDate, today) ?? -1) - (daysLive(a.startDate, today) ?? -1));
}

export type CompetitorTagSuggestion = { hook: string | null; offer: string | null };

export function suggestCompetitorTags(copy: string): CompetitorTagSuggestion {
  const hook = /\?/.test(copy) ? "question" : /\bmyth\b/i.test(copy) ? "myth_fact" : /\bchecklist\b/i.test(copy) ? "checklist" : /^\W*\d/.test(copy) ? "number" : /\bstep|^how\b/i.test(copy) ? "process" : null;
  const offer = /\bfree\s+(?:\w+\s+)?review\b/i.test(copy) ? "free_review" : /\bwebinar\b/i.test(copy) ? "webinar" : /\b(?:guide|e-?book)\b/i.test(copy) ? "guide" : /\bcalculator\b/i.test(copy) ? "calculator" : /\bcall\b/i.test(copy) ? "call" : null;
  return { hook, offer };
}

export const MAX_REFERENCES = 5;

export function attachReference(current: string[], adId: string): string[] {
  if (current.includes(adId)) return current;
  return current.length >= MAX_REFERENCES ? current : [...current, adId];
}

/** What a brief shows about a reference: tags and facts. Never the competitor's wording. */
export function referenceSummary(ad: { copy: string; format: string; hookTag: string | null; offerTag: string | null; startDate: string | null }, today: string): string {
  const parts = [`${ad.format} ad`];
  if (ad.hookTag) parts.push(`${ad.hookTag.replace(/_/g, " ")}-style hook`);
  if (ad.offerTag) parts.push(`offers a ${ad.offerTag.replace(/_/g, " ")}`);
  const d = daysLive(ad.startDate, today);
  if (d !== null) parts.push(`running ${d} days`);
  return `Reference (inspiration only, never to copy): ${parts.join(", ")}.`;
}

const words = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
const shingles = (w: string[], n: number) => new Set(w.length < n ? [] : w.slice(0, w.length - n + 1).map((_, i) => w.slice(i, i + n).join(" ")));

/** Whether a draft echoes a reference's wording: the share of the draft's three-word runs that also appear in a reference. */
export function similarityToReferences(draft: string, references: string[]): { tooSimilar: boolean; score: number } {
  const d = shingles(words(draft), 3);
  if (d.size < 4) return { tooSimilar: false, score: 0 };
  let best = 0;
  for (const r of references) {
    const rs = shingles(words(r), 3);
    let hit = 0;
    for (const s of d) if (rs.has(s)) hit++;
    best = Math.max(best, hit / d.size);
  }
  return { tooSimilar: best >= 0.5, score: Math.round(best * 100) / 100 };
}

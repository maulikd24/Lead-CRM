/**
 * "What the winners share." Pure. Takes creatives with their tags (format, hook type, offer, length, call to action) and
 * their funded outcomes, takes the cheapest-per-funded-customer third, and reports the tags that most of those share and
 * the rest do not. It says "not enough data" instead of guessing: with few creatives or few funded customers a pattern is
 * mostly luck. Tags are entered by a person or suggested as DRAFTS (by rules or by the draft-only AI path); a draft tag is
 * labelled as such everywhere it is used.
 */

export const TAG_TYPES = ["format", "hook", "offer", "length", "cta"] as const;
export type TagType = (typeof TAG_TYPES)[number];
export type Tags = Partial<Record<TagType, string>>;

export const TAG_VOCAB: Record<TagType, string[]> = {
  format: ["video", "image", "carousel", "text", "other"],
  hook: ["question", "process", "myth_fact", "checklist", "number", "story", "other"],
  offer: ["call", "webinar", "guide", "calculator", "free_review", "none"],
  length: ["short", "medium", "long"],
  cta: ["book_call", "learn_more", "sign_up", "download", "other"],
};
export const TAG_LABEL: Record<TagType, string> = { format: "Format", hook: "Hook", offer: "Offer", length: "Length", cta: "Call to action" };

export type TaggedCreative = { key: string; name: string; spend: number; funded: number; /** The CampaignOutcomeProvider's figure. Never computed here. */ costPerFunded: number | null; tags: Tags; /** DRAFT when any tag was only suggested. */ tagStatus: "CONFIRMED" | "DRAFT" };

export type WinnerSettings = {
  minCreatives: number;
  minFundedTotal: number;
  /** A winner must have funded at least this many customers, so one lucky customer is not a pattern. */
  minFundedPerWinner: number;
  /** A tag is "shared" when this share of winners carry it... */
  sharedShare: number;
  /** ...and it is at least this many points more common among winners than among the rest. */
  liftPoints: number;
};
export const DEFAULT_WINNER_SETTINGS: WinnerSettings = { minCreatives: 6, minFundedTotal: 15, minFundedPerWinner: 2, sharedShare: 0.6, liftPoints: 25 };

export type SharedTag = { type: TagType; value: string; winnersWith: number; winnersTotal: number; othersWith: number; othersTotal: number; liftPoints: number };
export type WinnersResult = { state: "ok" | "not_enough_data"; reason: string | null; winners: TaggedCreative[]; shared: SharedTag[]; usesDraftTags: boolean };

const costOf = (c: TaggedCreative) => c.costPerFunded ?? Number.POSITIVE_INFINITY;

export function findWinners(creatives: TaggedCreative[], settings: WinnerSettings = DEFAULT_WINNER_SETTINGS): WinnersResult {
  const pool = creatives.filter((c) => c.spend > 0 && Object.keys(c.tags).length > 0);
  const fundedTotal = pool.reduce((a, c) => a + c.funded, 0);
  const none = (reason: string): WinnersResult => ({ state: "not_enough_data", reason, winners: [], shared: [], usesDraftTags: false });
  if (pool.length < settings.minCreatives) return none(`Needs at least ${settings.minCreatives} tagged creatives with spend; there ${pool.length === 1 ? "is" : "are"} ${pool.length}.`);
  if (fundedTotal < settings.minFundedTotal) return none(`Needs at least ${settings.minFundedTotal} funded customers across these creatives to see a pattern; there ${fundedTotal === 1 ? "is" : "are"} ${fundedTotal}.`);

  const top = Math.ceil(pool.length / 3);
  const winners = pool.filter((c) => c.funded >= settings.minFundedPerWinner).sort((a, b) => costOf(a) - costOf(b)).slice(0, top);
  if (winners.length < 2) return none(`Needs at least 2 creatives that funded ${settings.minFundedPerWinner}+ customers each; there ${winners.length === 1 ? "is" : "are"} ${winners.length}.`);
  const winnerKeys = new Set(winners.map((w) => w.key));
  const others = pool.filter((c) => !winnerKeys.has(c.key));

  const shared: SharedTag[] = [];
  for (const type of TAG_TYPES) {
    const wTagged = winners.filter((w) => w.tags[type]);
    const oTagged = others.filter((o) => o.tags[type]);
    if (wTagged.length < 2) continue;
    for (const value of TAG_VOCAB[type]) {
      const w = wTagged.filter((x) => x.tags[type] === value).length;
      const o = oTagged.filter((x) => x.tags[type] === value).length;
      const wShare = w / wTagged.length;
      const oShare = oTagged.length ? o / oTagged.length : 0;
      const lift = Math.round((wShare - oShare) * 100);
      if (w >= 2 && wShare >= settings.sharedShare && lift >= settings.liftPoints) shared.push({ type, value, winnersWith: w, winnersTotal: wTagged.length, othersWith: o, othersTotal: oTagged.length, liftPoints: lift });
    }
  }
  shared.sort((a, b) => b.liftPoints - a.liftPoints);
  return { state: "ok", reason: null, winners, shared, usesDraftTags: winners.some((w) => w.tagStatus === "DRAFT") };
}

export const lengthBand = (chars: number): "short" | "medium" | "long" => (chars <= 100 ? "short" : chars <= 300 ? "medium" : "long");

/** Tags read off the ad's words and format by rules. They are suggestions: stored as drafts until a person confirms. */
export function heuristicTags(input: { copy: string; format: string }): Tags {
  const t: Tags = {};
  const f = input.format.toLowerCase();
  if (/video/.test(f)) t.format = "video";
  else if (/carousel/.test(f)) t.format = "carousel";
  else if (/image|photo|static/.test(f)) t.format = "image";
  else if (/responsive|text|search/.test(f)) t.format = "text";
  const copy = input.copy.trim();
  if (!copy) return t;
  if (/\?/.test(copy)) t.hook = "question";
  else if (/\bmyth\b/i.test(copy)) t.hook = "myth_fact";
  else if (/\bchecklist\b/i.test(copy)) t.hook = "checklist";
  else if (/\bstep|\bhow\s+(?:it|to|a|an|\w+)\b.*\bworks?\b|^how\b/i.test(copy)) t.hook = "process";
  else if (/^\W*\d/.test(copy)) t.hook = "number";
  if (/\bfree\s+(?:\w+\s+)?review\b/i.test(copy)) t.offer = "free_review";
  else if (/\bwebinar\b/i.test(copy)) t.offer = "webinar";
  else if (/\b(?:guide|e-?book)\b/i.test(copy)) t.offer = "guide";
  else if (/\bcalculator\b/i.test(copy)) t.offer = "calculator";
  else if (/\bcall\b/i.test(copy)) t.offer = "call";
  if (/\b(?:book|schedule)\b.*\bcall\b/i.test(copy)) t.cta = "book_call";
  else if (/learn\s+more|jaanein/i.test(copy)) t.cta = "learn_more";
  else if (/sign\s+up|register/i.test(copy)) t.cta = "sign_up";
  else if (/download/i.test(copy)) t.cta = "download";
  t.length = lengthBand(copy.length);
  return t;
}

export type ParsedTags = { ok: true; tags: Tags } | { ok: false; error: string };

/** A model's tag reply: JSON only, and only values from our vocabulary survive. */
export function parseAiTags(reply: string): ParsedTags {
  let raw: unknown;
  try {
    raw = JSON.parse(reply.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    return { ok: false, error: "The reply was not valid JSON." };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "The reply was not an object." };
  const tags: Tags = {};
  for (const type of TAG_TYPES) {
    const v = (raw as Record<string, unknown>)[type];
    if (typeof v === "string" && TAG_VOCAB[type].includes(v)) tags[type] = v;
  }
  return { ok: true, tags };
}

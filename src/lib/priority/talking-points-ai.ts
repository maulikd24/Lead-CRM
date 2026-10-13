import { createHash } from "node:crypto";

import { callModel, isAnthropicConfigured, isOpenAiConfigured, type GatewayDeps } from "@/lib/ai/gateway";
import { dayLabel } from "./detail";
import { hasSalesVocabulary, isClassEntry, mentionsBlockedClass } from "./class-terms";

/**
 * Optional AI rewrite of a customer's talking points, through the gateway under the "rm.talking_points" purpose.
 * Runs only when a provider key is present. Any failure, timeout, refusal, abstention or unexpected reply returns null,
 * and the caller keeps the deterministic points. The model never sees names, never changes the rank, and is held to:
 *  - the do-not-discuss list as a hard constraint; a card with any non-class entry (a complaint, a do-not-pitch rule) is
 *    not rewritten at all;
 *  - no blocked asset class, by stems and aliases (class-terms.ts);
 *  - when a sales block is present (a class is do-not-discuss), no sales vocabulary: pitch words or product names.
 * A rewrite is cached per client and points hash for the day, so a page load does not call the model twice.
 */

/** Hard ceiling on one rewrite. The gateway purpose has one attempt with the same limit (purposes.ts). */
export const AI_TALKING_POINTS_TIMEOUT_MS = 8_000;

const SYSTEM = [
  "You rewrite short talking points for a relationship manager at an Indian investment firm.",
  "Input: a JSON object with `points` (the draft points), `facts` (plain facts about the customer) and `doNotDiscuss` (a hard constraint).",
  "Rules: keep every fact; do not add products, figures, dates or names that are not in the input; do not suggest pitching anything not in the input;",
  "never mention or suggest anything in doNotDiscuss, and do not use sales words such as pitch, explore, offer or new; plain English, one sentence per point.",
  "Reply with only a JSON array of 2 or 3 strings and nothing else.",
].join(" ");

export function aiTalkingPointsAvailable(env: Record<string, string | undefined> = process.env): boolean {
  return isAnthropicConfigured(env) || isOpenAiConfigured(env);
}

/** Accepts exactly a JSON array of 2-3 non-empty strings of reasonable length, optionally fenced. Anything else is null. */
export function parseTalkingPointReply(text: string): string[] | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length < 2 || value.length > 3) return null;
  if (!value.every((v) => typeof v === "string" && v.trim().length > 0 && v.length <= 200)) return null;
  return (value as string[]).map((v) => v.trim());
}

/** Drops a reply that names a blocked asset class, by stems and aliases, so an AI rewrite can never re-introduce a pitch. */
export function respectsBlockedClasses(points: string[], blockedClasses: string[]): boolean {
  return points.every((p) => !mentionsBlockedClass(p, blockedClasses));
}

/** With a sales block present (a class is do-not-discuss), a reply may not use sales vocabulary at all. */
export function respectsSalesBlock(points: string[], doNotDiscuss: string[]): boolean {
  if (!doNotDiscuss.some(isClassEntry)) return true;
  return points.every((p) => !hasSalesVocabulary(p));
}

/** Per-day cache of accepted rewrites: key is client, points hash and the India calendar day. Only successes are cached. */
const cache = new Map<string, string[]>();
const CACHE_LIMIT = 500;

export function resetTalkingPointCache(): void {
  cache.clear();
}

function cacheKey(clientId: string, points: string[], now: Date): string {
  const hash = createHash("sha256").update(JSON.stringify(points)).digest("hex").slice(0, 32);
  return `${clientId}|${hash}|${dayLabel(now)}`;
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

export async function rewriteTalkingPoints(
  input: { clientId: string; points: string[]; facts: string[]; blockedClasses: string[]; doNotDiscuss?: string[]; now?: Date; timeoutMs?: number },
  deps?: GatewayDeps,
): Promise<string[] | null> {
  if (!aiTalkingPointsAvailable()) return null;
  const doNotDiscuss = input.doNotDiscuss ?? [];
  // Hard rule: any do-not-discuss entry that is not about an asset class (a complaint, a do-not-pitch rule) skips the rewrite.
  if (doNotDiscuss.some((entry) => !isClassEntry(entry))) return null;

  const now = input.now ?? new Date();
  const key = cacheKey(input.clientId, input.points, now);
  const hit = cache.get(key);
  if (hit) return hit;

  const timeoutMs = input.timeoutMs ?? AI_TALKING_POINTS_TIMEOUT_MS;
  try {
    const result = await withDeadline(
      callModel(
        {
          purpose: "rm.talking_points",
          system: SYSTEM,
          user: JSON.stringify({ points: input.points, facts: input.facts, doNotDiscuss }),
          subject: { type: "client", id: input.clientId },
          maxTokens: 300,
          timeoutMs,
        },
        deps,
      ),
      timeoutMs,
    );
    if (!result || result.kind !== "ok") return null;
    const parsed = parseTalkingPointReply(result.text);
    if (!parsed || !respectsBlockedClasses(parsed, input.blockedClasses) || !respectsSalesBlock(parsed, doNotDiscuss)) return null;
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

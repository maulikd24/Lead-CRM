import { findCandidatePairs } from "./candidate-pairs";
import { scoreDuplicate, SUGGESTION_THRESHOLD, type Identity } from "./duplicate-score";

export type Anchor = Identity & { createdAt: Date };
export type Scored = { clientAId: string; clientBId: string; score: number; reasons: string[] };
export type ExistingSuggestion = Scored & { status: string };
export type WritePlan = { create: Scored[]; refresh: Scored[]; reopen: Scored[] };

/** A DISMISSED suggestion is only re-opened when the evidence got materially stronger than when a human last said "not the same person". */
export const RESURFACE_DELTA = 0.15;

const sameReasons = (a: string[], b: string[]) => a.length === b.length && a.every((r, i) => r === b[i]);

/**
 * Pure: what to write for freshly scored pairs given what already exists.
 * New pair -> create. OPEN -> keep its score/reasons fresh. DISMISSED -> reopen only on a score rise of RESURFACE_DELTA or more,
 * or when it newly shares a PAN. MERGED -> never touched.
 */
export function planSuggestionWrites(scored: Scored[], existing: ExistingSuggestion[]): WritePlan {
  const byPair = new Map(existing.map((e) => [`${e.clientAId}:${e.clientBId}`, e]));
  const plan: WritePlan = { create: [], refresh: [], reopen: [] };
  for (const s of scored) {
    const e = byPair.get(`${s.clientAId}:${s.clientBId}`);
    if (!e) plan.create.push(s);
    else if (e.status === "OPEN") {
      if (e.score !== s.score || !sameReasons(e.reasons, s.reasons)) plan.refresh.push(s);
    } else if (e.status === "DISMISSED") {
      const newPan = s.reasons.includes("same PAN") && !e.reasons.includes("same PAN");
      if (s.score - e.score >= RESURFACE_DELTA - 1e-9 || newPan) plan.reopen.push(s);
    }
  }
  return plan;
}

export type JobDeps = {
  enabled: () => boolean;
  now: () => Date;
  loadState: () => Promise<{ cursor: Date | null; restUntil: Date | null }>;
  saveCursor: (cursor: Date | null) => Promise<void>;
  saveRestUntil: (until: Date) => Promise<void>;
  /** Live, unmerged customers created after `after`, oldest first. */
  loadAnchors: (after: Date | null, limit: number) => Promise<Anchor[]>;
  /** Every live customer (any age) sharing a mobile or email with one of the anchors. */
  loadPartners: (anchors: Anchor[]) => Promise<Anchor[]>;
  loadExisting: (pairs: [string, string][]) => Promise<ExistingSuggestion[]>;
  write: (plan: WritePlan) => Promise<void>;
};

export type JobOptions = {
  chunk?: number;
  maxChunks?: number;
  budgetMs?: number;
  /** After a full pass the job rests this long before it starts over (picks up edited mobiles/emails without hammering the DB). */
  restMs?: number;
};

export type JobResult = { skipped?: "disabled" | "resting"; anchors: number; created: number; reopened: number; refreshed: number; skippedBuckets: number; completedPass: boolean };

/**
 * Cron job: suggest-only, rotation-aware duplicate detection. Each tick takes the next window of customers after a stored cursor
 * (ordered by createdAt), and compares each window customer against EVERY live customer that shares a mobile or email with it,
 * so a pair is found no matter how far apart the two records are. The cursor is saved only after a window's rows are written;
 * when the end is reached it wraps and the job rests. Never merges anything and never writes to Client.
 */
export async function runMergeSuggestionJob(deps: JobDeps, opts: JobOptions = {}): Promise<JobResult> {
  const { chunk = 50, maxChunks = 4, budgetMs = 45_000, restMs = 6 * 60 * 60 * 1000 } = opts;
  const result: JobResult = { anchors: 0, created: 0, reopened: 0, refreshed: 0, skippedBuckets: 0, completedPass: false };
  if (!deps.enabled()) return { ...result, skipped: "disabled" };

  const startedAt = deps.now().getTime();
  const state = await deps.loadState();
  if (state.restUntil && state.restUntil.getTime() > startedAt) return { ...result, skipped: "resting" };

  let cursor = state.cursor;
  for (let i = 0; i < maxChunks; i++) {
    if (i > 0 && deps.now().getTime() - startedAt >= budgetMs) break;
    const anchors = await deps.loadAnchors(cursor, chunk);
    if (anchors.length > 0) {
      const anchorIds = new Set(anchors.map((a) => a.id));
      const partners = await deps.loadPartners(anchors);
      const universe = new Map<string, Anchor>();
      for (const r of [...partners, ...anchors]) universe.set(r.id, r);
      const { pairs, skippedBuckets } = findCandidatePairs([...universe.values()]);
      result.skippedBuckets += skippedBuckets.length;
      const scored: Scored[] = [];
      for (const [a, b] of pairs) {
        if (!anchorIds.has(a.id) && !anchorIds.has(b.id)) continue; // belongs to another window
        const { score, reasons } = scoreDuplicate(a, b);
        if (score >= SUGGESTION_THRESHOLD) scored.push({ clientAId: a.id, clientBId: b.id, score, reasons });
      }
      if (scored.length > 0) {
        const plan = planSuggestionWrites(scored, await deps.loadExisting(scored.map((s) => [s.clientAId, s.clientBId])));
        await deps.write(plan);
        result.created += plan.create.length;
        result.reopened += plan.reopen.length;
        result.refreshed += plan.refresh.length;
      }
      result.anchors += anchors.length;
      cursor = anchors[anchors.length - 1].createdAt;
      await deps.saveCursor(cursor);
    }
    if (anchors.length < chunk) {
      await deps.saveCursor(null);
      await deps.saveRestUntil(new Date(deps.now().getTime() + restMs));
      result.completedPass = true;
      break;
    }
  }
  return result;
}

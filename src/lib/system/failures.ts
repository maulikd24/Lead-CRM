import { jobSpec } from "./job-registry";

/**
 * The Failures list: every source folds into FailureItem rows, which are grouped by source, job (or integration) and error class.
 * Pure. A retry is offered ONLY where the source proves it is idempotent (an idempotent job, a failed lead intake), is capped at
 * MAX_RETRY_ATTEMPTS, and disappears once the group is no longer failing. Items hold classes, counts and ids, never a message or a name.
 */
export const MAX_RETRY_ATTEMPTS = 5;

export type FailureSourceKind = "job" | "webhook" | "lead-intake" | "whatsapp-outbox" | "clevertap" | "whatsapp-account" | "agent-proposal" | "closed-loop";
export type DataRisk = "none" | "unknown" | "at-risk";
export type RetryOffer = { kind: "job" | "lead-intake"; targetIds: string[] };

export type FailureItem = {
  id: string;
  source: FailureSourceKind;
  group: string;
  label: string;
  errorClass: string;
  reason: string;
  firstSeen: Date;
  lastSeen: Date;
  count: number;
  attempts: number;
  stillFailing: boolean;
  dead: boolean;
  retry: RetryOffer | null;
  /** "Was customer data lost?": none = nothing lost, at-risk = may be lost unless something else recovers it, unknown = cannot be determined here. */
  dataRisk: DataRisk;
  dataNote: string;
  link?: { href: string; label: string };
};

/**
 * Ad conversions that failed to reach a destination (the closed loop's outbox), one item per destination. Counts and times only: no customer, hashed identifier, token or response text.
 * Nothing is lost (every event stays in the outbox until it is sent or skipped); retries are per event, in the Closed loop Outbox, so no hand re-run is offered here.
 */
export function closedLoopFailureItem(p: { destination: string; label: string; dead: number; retrying: number; firstSeen: Date; lastSeen: Date; maxAttempts: number }): FailureItem {
  return {
    id: `closed-loop:${p.destination}`, source: "closed-loop", group: p.destination, label: `Ad conversions to ${p.label} that failed`, errorClass: "SendFailed",
    reason: p.dead > 0 ? "The platform refused them, or the retries ran out" : "The platform did not accept them; they are being retried",
    firstSeen: p.firstSeen, lastSeen: p.lastSeen, count: p.dead + p.retrying, attempts: p.maxAttempts, stillFailing: true, dead: p.dead > 0, retry: null,
    dataRisk: "none", dataNote: "No event is lost: each stays in the closed-loop outbox until it is sent or skipped. Retry one from the Outbox once the cause is fixed.",
    link: { href: p.dead > 0 ? "/closed-loop?tab=outbox&status=dead" : "/closed-loop?tab=outbox&status=failed", label: "Closed loop outbox" },
  };
}

export type FailureGroup = Omit<FailureItem, "id"> & { key: string };

const RISK_RANK: Record<DataRisk, number> = { none: 0, unknown: 1, "at-risk": 2 };

export function groupFailures(items: FailureItem[]): FailureGroup[] {
  const map = new Map<string, FailureGroup>();
  for (const it of items) {
    const key = `${it.source}|${it.group}|${it.errorClass}`;
    const g = map.get(key);
    if (!g) {
      const { id: _id, ...rest } = it;
      void _id;
      map.set(key, { ...rest, key, retry: it.retry ? { ...it.retry, targetIds: [...it.retry.targetIds] } : null });
      continue;
    }
    g.count += it.count;
    g.attempts = Math.max(g.attempts, it.attempts);
    if (it.firstSeen < g.firstSeen) g.firstSeen = it.firstSeen;
    if (it.lastSeen > g.lastSeen) { g.lastSeen = it.lastSeen; g.reason = it.reason; }
    g.stillFailing = g.stillFailing || it.stillFailing;
    g.dead = g.dead && it.dead;
    if (RISK_RANK[it.dataRisk] > RISK_RANK[g.dataRisk]) { g.dataRisk = it.dataRisk; g.dataNote = it.dataNote; }
    if (it.retry) {
      if (g.retry && g.retry.kind === it.retry.kind) g.retry.targetIds.push(...it.retry.targetIds);
      else if (!g.retry) g.retry = { ...it.retry, targetIds: [...it.retry.targetIds] };
    }
  }
  const groups = [...map.values()];
  for (const g of groups) if (!g.stillFailing || g.dead) g.retry = null;
  return groups.sort((a, b) => Number(b.stillFailing) - Number(a.stillFailing) || b.lastSeen.getTime() - a.lastSeen.getTime());
}

/** Only an idempotent cron job may be re-run by hand, and only until its retry chain reaches the cap. */
export function canRetryJob(key: string, attempt: number): boolean {
  const spec = jobSpec(key);
  return !!spec && spec.kind === "CRON" && spec.safeToRun && attempt < MAX_RETRY_ATTEMPTS;
}

export function jobFailureItem(r: { job: string; errorClass: string | null; count: number; firstSeen: Date; lastSeen: Date; latestId: string; latestAttempt: number; stillFailing: boolean }): FailureItem {
  const spec = jobSpec(r.job);
  const isHook = spec?.kind === "WEBHOOK";
  const dead = !isHook && r.latestAttempt >= MAX_RETRY_ATTEMPTS;
  const retryable = r.stillFailing && !dead && canRetryJob(r.job, r.latestAttempt);
  const safe = !!spec?.safeToRun;
  return {
    id: r.latestId, source: isHook ? "webhook" : "job", group: r.job, label: spec?.label ?? r.job, errorClass: r.errorClass ?? "Unknown",
    reason: r.errorClass ? `Failed with ${r.errorClass}` : "Failed", firstSeen: r.firstSeen, lastSeen: r.lastSeen, count: r.count, attempts: r.latestAttempt,
    stillFailing: r.stillFailing, dead, retry: retryable ? { kind: "job", targetIds: [r.latestId] } : null,
    dataRisk: isHook ? "at-risk" : safe ? "none" : "unknown",
    dataNote: isHook ? "The sender may redeliver. If it gives up, that event is lost." : safe ? "Runs again on a schedule and changes nothing twice; nothing is lost while it fails." : "Cannot be told from here: this job sends or changes things, so check what it produced.",
    link: { href: `/settings/control-plane?tab=jobs`, label: "Open in Jobs" },
  };
}

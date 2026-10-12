import { CONSENT_POLICY, DND_PURPOSE, type ConsentPolicy, type ConsentPurpose } from "./policy";

/** The fields of a ledger row the decision needs. A Prisma ConsentRecord satisfies this. */
export type ConsentRow = {
  id?: string;
  purpose: string;
  channel: string | null;
  status: "GRANTED" | "WITHDRAWN" | string;
  capturedAt: Date;
  expiresAt?: Date | null;
  source?: string;
  noticeVersion?: string | null;
};

export type ConsentState = "GRANTED" | "WITHDRAWN" | "EXPIRED" | "UNKNOWN" | "DO_NOT_CONTACT";
export type DenyReason = "DO_NOT_CONTACT" | "WITHDRAWN" | "EXPIRED" | "NO_RECORD";
export type ConsentReason = DenyReason | "GRANTED" | "GRANTED_LEGACY" | "DEFAULT_ALLOWED" | "RECORD_ONLY" | "ENFORCEMENT_OFF";

export type ConsentDecision = {
  allowed: boolean;
  reason: ConsentReason;
  state: ConsentState;
  /** Set only when a record-only purpose let something through that an enforced purpose would have stopped. */
  wouldBlock?: DenyReason;
};

export type DecisionOptions = {
  /** Client.marketingConsentAt: read as a MARKETING_COMMS grant from that moment, for every channel. No data migration. */
  legacyMarketingConsentAt?: Date | null;
  policy?: ConsentPolicy;
};

const time = (d: Date) => d.getTime();

/** Newest first. On a tie a WITHDRAWN row wins, then the channel-specific row, then the id (so the order is total). */
function newestFirst(a: ConsentRow, b: ConsentRow): number {
  if (time(a.capturedAt) !== time(b.capturedAt)) return time(b.capturedAt) - time(a.capturedAt);
  if (a.status !== b.status) return a.status === "WITHDRAWN" ? -1 : 1;
  if ((a.channel === null) !== (b.channel === null)) return a.channel === null ? 1 : -1;
  return (a.id ?? "").localeCompare(b.id ?? "");
}

/** Rows that apply to a channel: that channel's own rows plus the all-channel (null) rows. Rows dated after `now` are not yet in effect. */
function applicable(rows: readonly ConsentRow[], purpose: string, channel: string | null, now: Date): ConsentRow[] {
  return rows
    .filter((r) => r.purpose === purpose && time(r.capturedAt) <= time(now) && (r.channel === null || channel === null || r.channel === channel))
    .sort(newestFirst);
}

const isExpired = (r: ConsentRow, now: Date) => r.status === "GRANTED" && !!r.expiresAt && time(r.expiresAt) <= time(now);

/** True when a do-not-contact flag is in force for this channel. The latest flag row wins; a WITHDRAWN row lifts it. */
function doNotContactActive(rows: readonly ConsentRow[], channel: string | null, now: Date): boolean {
  const latest = applicable(rows, DND_PURPOSE, channel, now)[0];
  return !!latest && latest.status === "GRANTED" && !isExpired(latest, now);
}

type Raw = { state: ConsentState; reason: ConsentReason; granted: boolean };

function rawState(rows: readonly ConsentRow[], purpose: ConsentPurpose, channel: string | null, now: Date, legacy: Date | null | undefined): Raw {
  const list = applicable(rows, purpose, channel, now);
  if (purpose === "MARKETING_COMMS" && legacy && !Number.isNaN(time(legacy)) && time(legacy) <= time(now)) {
    list.push({ purpose, channel: null, status: "GRANTED", capturedAt: legacy, id: "legacy" });
    list.sort(newestFirst);
  }
  const latest = list[0];
  if (!latest) return { state: "UNKNOWN", reason: "NO_RECORD", granted: false };
  if (latest.status === "WITHDRAWN") return { state: "WITHDRAWN", reason: "WITHDRAWN", granted: false };
  if (isExpired(latest, now)) return { state: "EXPIRED", reason: "EXPIRED", granted: false };
  return { state: "GRANTED", reason: latest.id === "legacy" ? "GRANTED_LEGACY" : "GRANTED", granted: true };
}

/**
 * Pure. Whether we may contact or process for `purpose` on `channel` right now.
 * 1. An active do-not-contact flag denies every contact purpose, whatever else is on file and whatever the mode.
 * 2. Otherwise the latest applicable record decides, and the purpose's mode (policy.ts) says what "no grant" means.
 */
export function consentDecision(
  records: readonly ConsentRow[],
  purpose: ConsentPurpose,
  channel: string | null,
  now: Date,
  opts: DecisionOptions = {},
): ConsentDecision {
  const policy = (opts.policy ?? CONSENT_POLICY)[purpose];
  if (policy.honoursDoNotContact && doNotContactActive(records, channel, now)) {
    return { allowed: false, reason: "DO_NOT_CONTACT", state: "DO_NOT_CONTACT" };
  }
  const raw = rawState(records, purpose, channel, now, opts.legacyMarketingConsentAt);
  if (raw.granted) return { allowed: true, reason: raw.reason, state: raw.state };

  if (policy.mode === "record_only") {
    return { allowed: true, reason: "RECORD_ONLY", state: raw.state, wouldBlock: raw.reason as DenyReason };
  }
  if (policy.mode === "default_allow") {
    // Only an explicit withdrawal stops a default-allow purpose; silence and lapsed grants do not.
    return raw.state === "WITHDRAWN"
      ? { allowed: false, reason: "WITHDRAWN", state: raw.state }
      : { allowed: true, reason: "DEFAULT_ALLOWED", state: raw.state };
  }
  return { allowed: false, reason: raw.reason, state: raw.state };
}

/** One row per (purpose, channel): the newest. Used by the panel and the admin counts. Includes the legacy marketing grant when asked. */
export function currentStates<T extends ConsentRow>(rows: readonly T[]): T[] {
  const best = new Map<string, T>();
  for (const r of [...rows].sort(newestFirst)) {
    const key = `${r.purpose}|${r.channel ?? ""}`;
    if (!best.has(key)) best.set(key, r);
  }
  return [...best.values()];
}

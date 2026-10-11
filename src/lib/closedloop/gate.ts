import { consentDecision, type ConsentRow } from "@/lib/consent/decision";
import { adsGatePolicy, resolvePolicy } from "@/lib/consent/policy";

import type { MatchData } from "./hashing";

/** Why an event is not (or will not be) sent. Every one is plain English in `REASON_TEXT`. */
export type BlockReason =
  | "ERASED"
  | "CONSENT_MISSING"
  | "CONSENT_WITHDRAWN"
  | "CONSENT_EXPIRED"
  | "NO_IDENTIFIERS"
  | "KILL_SWITCH"
  | "DESTINATION_OFF"
  | "REGION_BLOCKED";

export const REASON_TEXT: Record<BlockReason, string> = {
  ERASED: "This customer was erased. Nothing is kept or sent.",
  CONSENT_MISSING: "No ad measurement consent was on file at the time. Nothing can be sent.",
  CONSENT_WITHDRAWN: "The customer withdrew ad measurement consent. Nothing more is sent.",
  CONSENT_EXPIRED: "The ad measurement consent has expired.",
  NO_IDENTIFIERS: "There is no email, phone or ad click id to match on, so the platform could not use the event.",
  KILL_SWITCH: "The kill switch is on: nothing leaves while it is on.",
  DESTINATION_OFF: "This destination is switched off or not set up.",
  REGION_BLOCKED: "This destination's data region has not been approved yet.",
};

export type Verdict = { ok: true } | { ok: false; reason: BlockReason };

/**
 * Pure. Was ad measurement consent granted at `at`? Always judged as an explicit opt-in (record-only never loosens it) and
 * never from the old lead-form tick: ad measurement was not part of what that tick said.
 */
export function adsConsentVerdict(rows: readonly ConsentRow[], at: Date, env: Record<string, string | undefined> = process.env): Verdict {
  const decision = consentDecision(rows, "ADS_MEASUREMENT", null, at, { policy: adsGatePolicy(resolvePolicy(env)) });
  if (decision.allowed) return { ok: true };
  return { ok: false, reason: decision.reason === "WITHDRAWN" ? "CONSENT_WITHDRAWN" : decision.reason === "EXPIRED" ? "CONSENT_EXPIRED" : "CONSENT_MISSING" };
}

/** What an Admin sets per destination. `allowedRegions` is empty until the owner has confirmed where the data may go. */
export type DestinationSettings = {
  enabled: boolean;
  /** Where this destination processes data, as the owner has recorded it (for example "in", "global"). */
  region: string | null;
  allowedRegions: string[];
  /** Send a rounded first-funding value. Off by default. */
  sendValue: boolean;
};

export const DEFAULT_DESTINATION_SETTINGS: DestinationSettings = { enabled: false, region: null, allowedRegions: [], sendValue: false };

export function regionVerdict(s: Pick<DestinationSettings, "region" | "allowedRegions">): Verdict {
  const region = s.region?.trim().toLowerCase();
  if (region && s.allowedRegions.some((r) => r.trim().toLowerCase() === region)) return { ok: true };
  return { ok: false, reason: "REGION_BLOCKED" };
}

export function destinationVerdict(s: DestinationSettings, ctx: { killSwitch: boolean }): Verdict {
  if (ctx.killSwitch) return { ok: false, reason: "KILL_SWITCH" };
  if (!s.enabled) return { ok: false, reason: "DESTINATION_OFF" };
  return regionVerdict(s);
}

export const hasIdentifiers = (m: MatchData): boolean => Boolean(m.hashedEmail || m.hashedPhone || m.fbc || m.fbp || m.gclid);

export type Explanation = { sendable: true } | { sendable: false; reason: BlockReason; text: string };

/** The first reason in a fixed order, for the "why wasn't this customer sent" explainer. */
export function explainWhyNotSent(input: {
  rows: readonly ConsentRow[];
  at: Date;
  match: MatchData;
  destination: DestinationSettings;
  killSwitch: boolean;
  erased: boolean;
  env?: Record<string, string | undefined>;
}): Explanation {
  const no = (reason: BlockReason): Explanation => ({ sendable: false, reason, text: REASON_TEXT[reason] });
  if (input.erased) return no("ERASED");
  const consent = adsConsentVerdict(input.rows, input.at, input.env);
  if (!consent.ok) return no(consent.reason);
  if (!hasIdentifiers(input.match)) return no("NO_IDENTIFIERS");
  const dest = destinationVerdict(input.destination, { killSwitch: input.killSwitch });
  if (!dest.ok) return no(dest.reason);
  return { sendable: true };
}

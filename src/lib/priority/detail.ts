import type { Level } from "@/lib/intelligence/constants";

/**
 * Per-customer detail for a Priority Clients card (bible section 07). Every builder here is pure: the loader reads the
 * rows, these functions turn them into the lines an RM reads. Deterministic templates come first; the optional AI
 * rewrite (talking-points-ai.ts) only ever replaces the talking points, never the rank or the do-not-discuss list.
 */

const DAY = 24 * 60 * 60 * 1000;
const RECENT_DECLINE_DAYS = 30;

export const DETAIL_TALKING_POINTS = { min: 2, max: 3 } as const;

const day = (date: Date) => date.toISOString().slice(0, 10);

const EVENT_LABELS: [prefix: string, label: string][] = [
  ["call.", "call"],
  ["message.", "message"],
  ["complaint.", "complaint"],
  ["customer.stage.changed", "stage change"],
  ["customer.consent.", "consent update"],
  ["customer.review.", "review"],
  ["customer.goal.", "goal update"],
  ["customer.memory.", "profile note"],
  ["customer.updated", "profile update"],
  ["customer.created", "customer created"],
];

/** Plain words for a CustomerEvent type, e.g. "call.logged" → "call". Unknown types read as their own words. */
export function eventLabel(eventType: string): string {
  for (const [prefix, label] of EVENT_LABELS) if (eventType === prefix || eventType.startsWith(prefix)) return label;
  return eventType.replace(/[._]+/g, " ").trim().toLowerCase() || "interaction";
}

function actorLabel(actorType: string): string {
  const t = actorType.toUpperCase();
  if (t === "RM" || t === "USER" || t === "HUMAN") return "RM";
  if (t.includes("AI")) return "AI agent";
  return "system";
}

export type LatestEvent = { eventType: string; occurredAt: Date; actorType: string };

/**
 * One line for the card: the last interaction and how busy the last 30 days were. Built from CustomerEvent rows only.
 * `latest` must be the newest event at or before today (the loader filters), or null when none is on record.
 */
export function summariseInteraction(latest: LatestEvent | null, countLast30: number): string {
  if (!latest) return "No interaction on record.";
  const busy = countLast30 === 0 ? "No events in the last 30 days" : `${countLast30} event${countLast30 === 1 ? "" : "s"} in the last 30 days`;
  return `Last: ${eventLabel(latest.eventType)} on ${day(latest.occurredAt)} by ${actorLabel(latest.actorType)}. ${busy}.`;
}

export type DeclineRow = { assetClass: string | null; createdAt: Date };

/**
 * Do-not-discuss for the card, in the order an RM should read it: service first, then what the customer declined
 * recently, then the Do-Not-Pitch rule, then whatever the Next Best Action already set aside.
 */
export function doNotDiscussList(input: {
  openComplaints: number;
  declines: DeclineRow[];
  programme: string;
  nbaReason: string;
  nbaDoNotDiscuss: string[];
  now: Date;
}): string[] {
  const out: string[] = [];
  if (input.openComplaints > 0) out.push("Open complaint: resolve it before any sales conversation");
  for (const d of input.declines) {
    if (!d.assetClass || input.now.getTime() - d.createdAt.getTime() > RECENT_DECLINE_DAYS * DAY || d.createdAt.getTime() > input.now.getTime()) continue;
    out.push(`${d.assetClass}: said not interested on ${day(d.createdAt)}; do not repeat the pitch`);
  }
  if (input.programme === "No Action / Do Not Pitch") out.push(`Do not pitch now: ${input.nbaReason}`);
  out.push(...input.nbaDoNotDiscuss);
  return [...new Set(out)];
}

/** Asset classes the card must not pitch: named in do-not-discuss, or declined recently. */
export function blockedClassesFrom(doNotDiscuss: string[], declines: DeclineRow[], assetClasses: readonly string[], now: Date): string[] {
  const declined = declines.filter((d) => d.assetClass && now.getTime() - d.createdAt.getTime() <= RECENT_DECLINE_DAYS * DAY).map((d) => d.assetClass!);
  return assetClasses.filter((c) => declined.includes(c) || doNotDiscuss.some((s) => s.startsWith(`${c}:`)));
}

export type TalkingPointInput = {
  commitments: { text: string; dueAt: Date | null; overdue: boolean }[];
  lastInteraction: LatestEvent | null;
  highAcceptance: { assetClass: string; reason: string }[];
  nbaTalkingPoints: string[];
  blockedClasses: string[];
  now: Date;
};

/**
 * Two or three talking points, from facts first: an open promise, the last contact, a High acceptance, then the Next
 * Best Action's own points. A class that is blocked never gets a talking point. Pads with two neutral prompts if the
 * facts are thin, so an RM always has something to open with.
 */
export function buildTalkingPoints(input: TalkingPointInput): string[] {
  const points: string[] = [];
  const first = input.commitments[0];
  if (first) {
    const due = first.dueAt ? ` (${first.overdue ? "was due" : "due"} ${day(first.dueAt)})` : "";
    points.push(`Close the loop on: ${first.text}${due}`);
  }
  if (input.lastInteraction) points.push(`Pick up from the last ${eventLabel(input.lastInteraction.eventType)} on ${day(input.lastInteraction.occurredAt)}`);
  const high = input.highAcceptance.find((a) => !input.blockedClasses.includes(a.assetClass));
  if (high) points.push(`${high.assetClass} is a High acceptance: ${high.reason}`);
  for (const p of input.nbaTalkingPoints) if (!input.blockedClasses.some((c) => p.includes(c))) points.push(p);

  const unique = [...new Set(points)].slice(0, DETAIL_TALKING_POINTS.max);
  const padding = ["Ask what has changed since the last conversation", "Agree the next step and when to talk again"];
  for (const p of padding) {
    if (unique.length >= DETAIL_TALKING_POINTS.min) break;
    if (!unique.includes(p)) unique.push(p);
  }
  return unique;
}

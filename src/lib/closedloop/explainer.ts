import type { ConsentRow } from "@/lib/consent/decision";

import { detectEvents, EVENT_LABEL, type AumBand, type ClientFacts } from "./events";
import { explainWhyNotSent, type DestinationSettings } from "./gate";
import { buildMatchData } from "./hashing";

export type ExplainerDestination = { key: string; label: string; platform: "meta" | "google"; settings: DestinationSettings };

export type Explainer =
  | { kind: "no_destination" }
  | { kind: "no_event" }
  | { kind: "lines"; events: string[]; lines: { destination: string; sendable: boolean; text: string }[] };

/**
 * "Why wasn't this customer sent?" for Customer 360's consent tab. Visible to everyone who sees that tab, so it carries REASONS
 * ONLY: no spend, campaign, revenue or cost figure, and no identifier. Pure: the loader gathers the facts, this decides the words.
 * Consent is judged at the time of the customer's latest qualifying event, as the sender does.
 */
export function explainCustomer(input: {
  rows: readonly ConsentRow[];
  facts: ClientFacts;
  email: string | null;
  mobile: string | null;
  attribution: Record<string, unknown> | null;
  createdAt: Date;
  destinations: ExplainerDestination[];
  killSwitch: boolean;
  now: Date;
  aumBands: AumBand[] | null;
}): Explainer {
  if (input.destinations.length === 0) return { kind: "no_destination" };
  const events = detectEvents(input.facts, { aumBands: input.aumBands });
  if (events.length === 0) return { kind: "no_event" };
  const latest = events[events.length - 1];
  const lines = input.destinations.map((d) => {
    const match = buildMatchData(d.platform, { email: input.email, mobile: input.mobile, attribution: input.attribution }, input.createdAt);
    const r = explainWhyNotSent({ rows: input.rows, at: latest.occurredAt, match, destination: d.settings, killSwitch: input.killSwitch, erased: false });
    return { destination: d.label, sendable: r.sendable, text: r.sendable ? "Will be sent (or already was) once the next run picks it up." : r.text };
  });
  return { kind: "lines", events: events.map((e) => EVENT_LABEL[e.type]), lines };
}

/** The one-line state for a phone's dense row. Reasons only: never a figure or an identifier. */
export function explainerSummary(e: Explainer): string {
  if (e.kind === "no_destination") return "No ad destination is on";
  if (e.kind === "no_event") return "Nothing to send yet";
  const ok = e.lines.filter((l) => l.sendable).length;
  if (ok === e.lines.length) return "Can be sent";
  if (ok === 0) return "Not sent";
  return `Sent to ${ok} of ${e.lines.length} destinations`;
}

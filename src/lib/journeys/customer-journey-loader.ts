import { getCustomerTimeline, type TimelineViewer } from "@/lib/timeline/reader";

import { evaluateJourney, type JourneyDef, type JourneyEvaluation, type JourneyEventFact } from "./customer-journey";
import { customerJourneysEnabled } from "./customer-journey-flag";

/**
 * Loads one customer's journey progress. It reads CustomerEvents only through getCustomerTimeline (the one canonical reader), which enforces
 * role scoping itself: a viewer who may not open this customer's 360 gets "not_found" (an RM sees only leads they own), so no journey data leaks.
 * Read only: no writes, no messages, no drafts. The result is a recommendation.
 */

/** Pages of 200 newest-first items to walk back through; enough for a long history without an unbounded read. */
const MAX_PAGES = 10;

export type JourneyLoadResult =
  | { ok: true; evaluation: JourneyEvaluation; /** False when older events existed beyond MAX_PAGES: earlier steps may be under-counted. */ historyComplete: boolean }
  | { ok: false; reason: "disabled" | "forbidden" | "not_found" };

export async function loadCustomerJourney(
  clientId: string,
  def: JourneyDef,
  o: { viewer: TimelineViewer; now?: Date; env?: Record<string, string | undefined> },
): Promise<JourneyLoadResult> {
  if (!customerJourneysEnabled(o.env)) return { ok: false, reason: "disabled" };

  const facts: JourneyEventFact[] = [];
  let before: string | null = null;
  let historyComplete = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await getCustomerTimeline(clientId, { viewer: o.viewer, includeEvents: true, limit: 200, before, now: o.now });
    if (!r.ok) return { ok: false, reason: r.reason };
    for (const item of r.items) {
      if (item.source !== "event" || !item.eventType) continue;
      facts.push({ eventType: item.eventType, occurredAt: new Date(item.at) });
    }
    if (!r.olderNotShown || !r.nextCursor) {
      historyComplete = !r.olderNotShown;
      break;
    }
    before = r.nextCursor;
  }

  return { ok: true, evaluation: evaluateJourney(def, facts, o.now ?? new Date()), historyComplete };
}

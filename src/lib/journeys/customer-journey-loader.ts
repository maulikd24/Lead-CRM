import { getCustomerEventFacts, type TimelineViewer } from "@/lib/timeline/reader";

import { evaluateJourney, type JourneyDef, type JourneyEvaluation } from "./customer-journey";
import { customerJourneysEnabled } from "./customer-journey-flag";

/**
 * Loads one customer's journey progress. It reads ALL CustomerEvents through getCustomerEventFacts, not the display timeline: the timeline hides an
 * event whose domain record (KYC, transaction) is already shown, and a journey step must still count that event. Role scoping is the same as the
 * 360 page (a viewer who may not open the customer gets "not_found", so no journey data leaks).
 * Read only: no writes, no messages, no drafts. The result is a recommendation.
 */

export type JourneyLoadResult =
  | { ok: true; evaluation: JourneyEvaluation; /** False when more CustomerEvents exist than the read considers: earlier steps may be under-counted. */ historyComplete: boolean }
  | { ok: false; reason: "disabled" | "forbidden" | "not_found" };

export async function loadCustomerJourney(
  clientId: string,
  def: JourneyDef,
  o: { viewer: TimelineViewer; now?: Date; env?: Record<string, string | undefined> },
): Promise<JourneyLoadResult> {
  if (!customerJourneysEnabled(o.env)) return { ok: false, reason: "disabled" };

  const r = await getCustomerEventFacts(clientId, { viewer: o.viewer });
  if (!r.ok) return r;
  return { ok: true, evaluation: evaluateJourney(def, r.events, o.now ?? new Date()), historyComplete: r.complete };
}

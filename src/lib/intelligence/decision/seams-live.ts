// The real implementations of the engine's seams (Wave 2 integration). The pure pipeline never imports this file; the database-side callers (loader, shadow, feedback)
// do, through liveSeams(). Each piece reads another workstream through its published read API only: memory (getMemoryForDecisions), service state
// (getServiceSignals), the product registry (listProducts + cite), the event spine (emitDecisionEvent). Nothing here sends anything.
import { getMemoryForDecisions } from "@/lib/memory/read";
import { writeMemoryItem } from "@/lib/memory/store";
import { productRegistryEnabled } from "@/lib/registry/flag";
import { getServiceSignals } from "@/lib/service/read";
import { emitDecisionEvent } from "@/lib/events/producers-emit";
import { citationsFromResults, memoryToGate } from "./integration";
import { defaultSeams, type CustomerMemorySource, type ComplaintCommitmentSource, type DecisionEventSink, type DecisionSeams, type MemoryWriteSink, type ProductRegistrySource } from "./seams";

export const liveMemorySource: CustomerMemorySource = {
  async read(clientId, now) {
    return memoryToGate(await getMemoryForDecisions(clientId, now));
  },
};

export const liveComplaintSource: ComplaintCommitmentSource = {
  async complaint(clientId) {
    const s = await getServiceSignals(clientId);
    const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
    return { open: s.complaint.open, lastAt: s.complaint.lastAt, because: s.complaint.lastAt ? `${s.complaint.open ? "Open complaint" : "Complaint"} on ${day(s.complaint.lastAt)}` : null };
  },
  async signals(clientId, now) {
    const s = await getServiceSignals(clientId, now);
    return { openComplaints: s.openComplaints, overdueCommitments: s.overdueCommitments };
  },
};

export const liveRegistrySource: ProductRegistrySource = {
  async blocks() {
    return [];
  },
  async citations(now) {
    const enforced = productRegistryEnabled();
    if (!enforced) return citationsFromResults([], false);
    const { cite, listProducts } = await import("@/lib/registry/service");
    const rows = await listProducts();
    const results = await Promise.all(rows.map(async (r) => ({ category: r.category, id: r.head.id, result: await cite(r.head.id, now) })));
    return citationsFromResults(results.map((x) => ({ category: x.category, id: x.id, result: x.result.ok ? { ok: true as const, productId: x.id } : { ok: false as const, productId: x.id, reason: x.result.reason } })), true);
  },
};

/** nba.decision.* through emit(): a no-op unless CUSTOMER_EVENTS_ENABLED=1, never throws, ids and codes only (see events/producers.ts buildDecisionEvent). */
export const liveEventSink: DecisionEventSink = {
  async emit(event) {
    await emitDecisionEvent(event);
  },
};

/** "Do not recommend this" becomes a visible suppression memory item (class DO_NOT_DO) through the normal memory store, besides the SuggestionDismissal the other screens honour. */
export const liveMemoryWriteSink: MemoryWriteSink = {
  async writeSuppression(input) {
    const actorType = input.byRole === "MANAGER" ? "MANAGER" : input.byRole === "ADMIN" ? "ADMIN" : "RM";
    const text = `Do not recommend ${input.scope}${input.reason ? ` (reason: ${input.reason})` : ""}`;
    const at = new Date();
    const res = await writeMemoryItem({
      clientId: input.clientId,
      class: "DO_NOT_DO",
      key: `do_not_do:recommend:${input.scope}`,
      value: { text, scope: input.scope, ...(input.assetClass ? { assetClass: input.assetClass } : {}) },
      sourceType: "rm_entry",
      sourceRef: `user:${input.byUserId}`,
      evidence: [{ sourceRef: `user:${input.byUserId}`, summary: `Marked do not recommend ${input.scope} from the decision drawer`, observedAt: at }],
      observedAt: at,
      freshUntil: input.until,
      actor: { type: actorType, userId: input.byUserId },
      correlationId: input.decisionId,
    });
    if (!res.ok) console.error("decision engine: do-not-recommend memory item not written:", res.code);
  },
};

export const liveSeams = (): DecisionSeams => ({ ...defaultSeams(), memory: liveMemorySource, complaints: liveComplaintSource, registry: liveRegistrySource, events: liveEventSink, memoryWrite: liveMemoryWriteSink });

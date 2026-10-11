/**
 * The seam to the Wave 1 event spine. EVENT_TAXONOMY names four `customer.memory.*` events (proposed, confirmed, rejected,
 * expired); this module adds `disputed` and `superseded`. allvest/w1-events is not on this branch, so nothing here calls emit().
 * Every memory write already leaves an AuditLog row (the durable record); at integration, call `setMemoryEventSink(emit)` once at
 * startup and the same payloads flow to CustomerEvent. The payload carries ids and states only: never item content, never evidence.
 */
export type MemoryEventType = "customer.memory.proposed" | "customer.memory.confirmed" | "customer.memory.rejected" | "customer.memory.expired" | "customer.memory.disputed" | "customer.memory.superseded";

export type MemoryEvent = {
  type: MemoryEventType;
  occurredAt: Date;
  clientId: string;
  itemId: string;
  class: string;
  actorType: string;
  actorId: string | null;
  correlationId: string | null;
  causationId: string | null;
  dataClass: string;
};

type Sink = (event: MemoryEvent) => void | Promise<void>;
let sink: Sink | null = null;

export function setMemoryEventSink(next: Sink | null): void {
  sink = next;
}

/** Fire-and-forget: a failing sink never fails (or rolls back) the memory write it describes. */
export async function emitMemoryEvent(event: MemoryEvent): Promise<void> {
  if (!sink) return;
  try {
    await sink(event);
  } catch (error) {
    console.error("customer memory event sink failed", error instanceof Error ? error.name : "unknown");
  }
}

/**
 * Memory events go through emit() (the Wave 1 event spine): `customer.memory.*` are registered event types (events/registry.ts) and the default
 * delivery is `emitMemoryEvent` from events/producers-emit.ts, which does nothing unless CUSTOMER_EVENTS_ENABLED=1 and never throws. Every memory
 * write also leaves an AuditLog row (the durable record), so with the events flag off nothing is lost. The payload carries ids, class and state only:
 * never item content, never evidence. `setMemoryEventSink` stays as a test override.
 */
import { emitMemoryEvent as emitToEvents } from "@/lib/events/producers-emit";

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
  try {
    if (sink) await sink(event);
    else await emitToEvents(event);
  } catch (error) {
    console.error("customer memory event sink failed", error instanceof Error ? error.name : "unknown");
  }
}

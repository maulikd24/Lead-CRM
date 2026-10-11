import type { EventConsumer } from "@/lib/events/consumers";

/**
 * The closed loop's side of the one event path. The conversion outbox is fed from the canonical customer events (KYC verified, account funded) instead of
 * only from its own sweep of client tables; the sweep stays as the safety net, because an event written after its domain commit can be lost (a known debt
 * of the event layer), and both paths run the SAME producer, so they cannot disagree: rows are keyed by (destination, dedup id), the dedup id depends only
 * on the customer and the event type, and consent is judged by the same gate at the event's own time.
 *
 * The consumer queues and cancels; it never sends (`sideEffects: "none"`): the drain does that, behind the kill switch, region and consent checks.
 * It is idempotent, so redelivery and replay are safe.
 */
export const CLOSED_LOOP_CONSUMER = "closed-loop-intake";
export const INTAKE_TYPES = ["account.kyc.verified", "account.funded", "customer.consent.withdrawn"] as const;

export type IntakeDeps = {
  enabled: () => boolean;
  /** Queue this customer's conversion events (same producer as the sweep). */
  intakeFor: (clientId: string) => Promise<unknown>;
  /** Take this customer's not-yet-sent rows out of the queue (ad measurement withdrawn). */
  cancelFor: (clientId: string) => Promise<number>;
};

const purposeOf = (metadata: unknown): string | null => {
  const p = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).purpose : null;
  return typeof p === "string" ? p : null;
};

export function closedLoopIntakeConsumer(deps: IntakeDeps): EventConsumer {
  return {
    name: CLOSED_LOOP_CONSUMER,
    types: INTAKE_TYPES,
    sideEffects: "none",
    async handle(event) {
      if (!deps.enabled() || !event.clientId) return;
      if (event.eventType === "customer.consent.withdrawn") {
        if (purposeOf(event.metadata) === "ADS_MEASUREMENT") await deps.cancelFor(event.clientId);
        return;
      }
      await deps.intakeFor(event.clientId);
    },
  };
}

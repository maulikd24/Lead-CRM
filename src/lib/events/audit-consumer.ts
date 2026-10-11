import type { EventConsumer } from "./consumers";
import { readEvent } from "./emit";

export class EventUnreadableError extends Error {
  constructor(reason: string) {
    super(`event is not readable: ${reason}`);
    this.name = "EventUnreadableError";
  }
}

/**
 * The no-op audit consumer: it proves the plumbing (cursor, at-least-once delivery, dead letters, lag) without doing any work on the
 * customer. It only checks that every event is readable at its stored version and carries a correlation id; an event that is not
 * is dead-lettered after the retry limit, which is exactly what the Health tab should show. No side effects, safe to replay.
 */
export const auditConsumer: EventConsumer = {
  name: "audit",
  sideEffects: "none",
  async handle(event) {
    const read = readEvent(event);
    if (!read.ok) throw new EventUnreadableError(read.reason);
    if (!event.correlationId) throw new EventUnreadableError("missing_correlation");
  },
};

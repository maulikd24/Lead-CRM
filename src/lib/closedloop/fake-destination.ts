import type { ConversionDestination, DestinationKey, EventResult, OutboundEvent } from "./types";

/**
 * The destination used by tests and the demo. No network. It remembers what it was given (so a test can assert that no
 * raw personal data arrived), can be told to fail, and reports a match when the event carries any identifier.
 */
export class FakeDestination implements ConversionDestination {
  platform: "meta" | "google" = "meta";
  maxBatch = 50;
  maxEventAgeDays = 7;
  received: OutboundEvent[] = [];
  calls = 0;
  /** Script outcomes by dedup id; anything not scripted is "sent". Set `failAll` to simulate an outage. */
  script = new Map<string, Pick<EventResult, "outcome" | "errorCode" | "retryAfterMs">>();
  failAll: Pick<EventResult, "errorCode" | "retryAfterMs"> | null = null;
  throwOnSend = false;

  constructor(public key: DestinationKey = "fake") {}

  async send(events: OutboundEvent[]): Promise<EventResult[]> {
    this.calls += 1;
    if (this.throwOnSend) throw new Error("network down");
    return events.map((e) => {
      if (this.failAll) return { dedupId: e.dedupId, outcome: "retry" as const, ...this.failAll };
      const scripted = this.script.get(e.dedupId);
      if (scripted) return { dedupId: e.dedupId, ...scripted };
      this.received.push(e);
      const i = e.identity;
      return { dedupId: e.dedupId, outcome: "sent" as const, matched: Boolean(i.hashedEmail || i.hashedPhone || i.fbc || i.fbp || i.gclid) };
    });
  }
}

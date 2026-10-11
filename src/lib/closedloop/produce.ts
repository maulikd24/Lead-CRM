import { detectEvents, roundedValue, type AumBand, type ClientFacts } from "./events";
import { adsConsentVerdict, hasIdentifiers } from "./gate";
import { buildMatchData } from "./hashing";
import type { ConsentLoader, DestinationContext, OutboxStore } from "./types";

/** What the loader hands over for one customer. Raw email and phone are used here to build hashes and go no further. */
export type Candidate = {
  facts: ClientFacts;
  email: string | null;
  mobile: string | null;
  attribution: Record<string, unknown> | null;
  clientCreatedAt: Date;
};

export type ProduceDeps = {
  store: OutboxStore;
  /** Customers whose KYC or funding changed recently (or who may have reached an assets band), never erased, deleted or merged away. */
  loadCandidates: (now: Date) => Promise<Candidate[]>;
  loadConsent: ConsentLoader;
  destinations: () => Promise<Map<string, DestinationContext>>;
  aumBands: () => AumBand[] | null;
  now: () => Date;
  env?: Record<string, string | undefined>;
};

export type ProduceResult = { queued: number; skipped: number; existing: number };

/**
 * Turns existing client data into outbox rows. Nothing is invented: an event exists only because KYC was approved, the
 * funding record became (partially) funded, or (when configured) assets reached a band. Consent is judged AT the event's
 * own time, so a grant that came later never covers an earlier event. Rows are keyed by (destination, stable dedup id), so
 * running this as often as you like cannot duplicate anything. A customer who fails a check still gets a SKIPPED row with
 * the reason, so the explainer and the coverage screen can say why.
 */
export async function produceOutbox(deps: ProduceDeps): Promise<ProduceResult> {
  const now = deps.now();
  const result: ProduceResult = { queued: 0, skipped: 0, existing: 0 };
  const contexts = [...(await deps.destinations()).entries()].filter(([, c]) => c.settings.enabled);
  if (contexts.length === 0) return result;

  const candidates = await deps.loadCandidates(now);
  if (candidates.length === 0) return result;
  const consent = await deps.loadConsent(candidates.map((c) => c.facts.clientId));
  const bands = deps.aumBands();

  for (const c of candidates) {
    const events = detectEvents(c.facts, { aumBands: bands });
    for (const event of events) {
      const verdict = adsConsentVerdict(consent.get(c.facts.clientId) ?? [], event.occurredAt, deps.env);
      for (const [key, ctx] of contexts) {
        const identity = buildMatchData(ctx.destination.platform, { email: c.email, mobile: c.mobile, attribution: c.attribution }, c.clientCreatedAt);
        const reason = !verdict.ok ? verdict.reason : !hasIdentifiers(identity) ? "NO_IDENTIFIERS" : null;
        const { created } = await deps.store.insertIfAbsent(
          {
            clientId: c.facts.clientId, destination: key as never, eventType: event.type, qualifier: event.qualifier, dedupId: event.dedupId, occurredAt: event.occurredAt,
            // A skipped row keeps no identifiers at all: nothing to send, nothing to leak.
            identity: reason ? {} : identity,
            value: !reason && ctx.settings.sendValue && event.type === "FIRST_FUNDING" ? roundedValue(event.amount) : null,
            status: reason ? "SKIPPED" : "PENDING", reason,
          },
          now,
        );
        if (!created) result.existing += 1;
        else if (reason) result.skipped += 1;
        else result.queued += 1;
      }
    }
  }
  return result;
}

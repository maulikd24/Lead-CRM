import type { IngestOutcome } from "@/lib/leads/ingest";

/** HTTP status and body for an ingest outcome. created/duplicate/replay are 200 (a retry must not be re-sent);
 * rejected is 422 with a short reason; error is 500 with no internal detail (the ledger row is retried by cron). */
export function statusForOutcome(outcome: IngestOutcome): { http: number; body: Record<string, unknown> } {
  switch (outcome.status) {
    case "created":
    case "duplicate":
    case "replay":
      return { http: 200, body: { ok: true, status: outcome.status } };
    case "rejected":
      return { http: 422, body: { error: "Signup rejected", reason: outcome.reason } };
    default:
      return { http: 500, body: { error: "Could not process signup" } };
  }
}

/** A payload the mapper refused (missing/invalid required field): 422, distinct from malformed JSON (400). */
export function statusForMapperFailure(reason: string): { http: number; body: Record<string, unknown> } {
  return { http: 422, body: { error: "Invalid payload", reason } };
}

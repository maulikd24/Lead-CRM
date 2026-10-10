/** Failure kinds shared by every read-only ad-platform client; the sync decides what to do from `kind` alone. */
export type AdsErrorKind = "config" | "deadline" | "rate_limit" | "auth" | "transient" | "timeout" | "schema" | "paging" | "http";

/**
 * Base class for ad-platform client errors. Messages are built from status codes and fixed text only, so a response
 * body, token or secret can never end up in a message (and from there in the sync ledger or the page).
 */
export class AdsApiError extends Error {
  constructor(
    public readonly kind: AdsErrorKind,
    message: string,
    public readonly extra: { status?: number; code?: number; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = "AdsApiError";
  }
  get status() {
    return this.extra.status;
  }
  get code() {
    return this.extra.code;
  }
  get retryAfterMs() {
    return this.extra.retryAfterMs;
  }
}

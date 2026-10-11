import { createHash } from "node:crypto";

export { pseudonymize as analyticsPseudonym } from "@/lib/access/pseudonym";

/**
 * The one place that turns an identifier into something else, with an explicit PURPOSE for each function (the duplication report's D13). Do not hash anywhere else.
 *
 *  - `vendorMatchHash`: what an ad platform matches on. Plain SHA-256 of an already-normalised value, because the platform computes the same hash on its side: a keyed or salted
 *    hash would never match. Because it is unkeyed it is reversible for guessable inputs (a phone number): it may only be sent to a vendor the customer consented to, never stored
 *    where a screen can see it, and never used as a stand-in for a person.
 *  - `analyticsPseudonym` (re-exported from the access module): a KEYED stand-in for a customer on a screen or report that must not identify them. Cannot be recomputed without the secret.
 *  - `eventDedupDigest`: a stable id for "this event, once" (the platforms deduplicate on it). Deterministic by design, so it must stay unkeyed (a rotated secret would make every
 *    event look new and double-count); it carries no personal value and is useful only to us.
 */
export const vendorMatchHash = (normalisedValue: string): string => createHash("sha256").update(normalisedValue, "utf8").digest("hex");

export const eventDedupDigest = (namespace: string, parts: readonly string[]): string => `${namespace}_${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32)}`;

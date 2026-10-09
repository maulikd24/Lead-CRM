import { verifyHmacSha256 } from "@/lib/security/webhook-auth";

/** A signed request older (or newer) than this is refused: a captured request cannot be replayed later. */
export const MAX_CLOCK_SKEW_SECONDS = 300;

/**
 * The signature covers the timestamp AND the body: hex HMAC-SHA256 of `${timestamp}.${rawBody}` where `timestamp` is
 * the x-timestamp header, whole Unix seconds. A "sha256=" prefix on the signature is accepted.
 * "invalid" for anything missing or wrong (nothing else is revealed); "stale" only for a correctly signed request
 * outside the window.
 */
export function verifyFeedSignature(input: { secret: string; timestamp: string | null; signature: string | null; rawBody: string; nowMs?: number }): "ok" | "invalid" | "stale" {
  const { secret, timestamp, signature, rawBody } = input;
  if (!timestamp || !/^\d{1,12}$/.test(timestamp)) return "invalid";
  if (!verifyHmacSha256(secret, `${timestamp}.${rawBody}`, signature)) return "invalid";
  const nowSec = Math.floor((input.nowMs ?? Date.now()) / 1000);
  return Math.abs(nowSec - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS ? "stale" : "ok";
}

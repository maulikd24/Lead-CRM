import crypto from "node:crypto";

/** Constant-time string comparison. False for missing values, so a blank configured secret never matches. */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** Verifies a hex HMAC-SHA256 of the raw body, as sent by Meta ("sha256=<hex>"), Jira ("sha256=<hex>") and
 * ClickUp ("<hex>"). Fails closed when the secret or signature is missing. */
export function verifyHmacSha256(secret: string | null | undefined, rawBody: string, signature: string | null | undefined): boolean {
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return safeEqual(expected, signature.replace(/^sha256=/i, "").toLowerCase());
}

/** Production deployments only accept webhooks from providers switched to "live" with a verifiable secret —
 * mock adapters (the default for an unconfigured provider) authenticate nothing. */
export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL_ENV === "production";
}

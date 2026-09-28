import crypto from "node:crypto";

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Signature covers method + path + query + timestamp + raw body, so a captured request can't be
 * replayed against a different route or after the 5-minute window. The worker computes the same
 * string (see whatsapp-worker/src/crm-client.ts).
 */
export function signWorkerRequest(secret: string, timestamp: string, method: string, pathWithQuery: string, rawBody: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${method.toUpperCase()}.${pathWithQuery}.${rawBody}`).digest("hex");
}

/** Fails closed: if WHATSAPP_WORKER_SECRET is unset, every request is rejected. */
export function verifyWorkerRequest(request: Request, rawBody: string): boolean {
  const secret = process.env.WHATSAPP_WORKER_SECRET;
  if (!secret) return false;

  const timestamp = request.headers.get("x-worker-timestamp");
  const signature = request.headers.get("x-worker-signature");
  if (!timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_CLOCK_SKEW_MS) return false;

  const url = new URL(request.url);
  const expected = signWorkerRequest(secret, timestamp, request.method, `${url.pathname}${url.search}`, rawBody);

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

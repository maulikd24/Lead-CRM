import { prisma } from "@/lib/db/prisma";

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

/** Fixed-window counter in Postgres: one atomic upsert per request, shared across every serverless instance.
 * Fails open — if the counter can't be written the request is allowed, so a DB blip never takes webhooks down.
 * This is the app-level backstop; volumetric floods belong at the edge (Vercel Firewall rate-limit rules). */
export async function rateLimit(name: string, identifier: string, opts: { limit: number; windowSeconds: number }, now = new Date()): Promise<RateLimitResult> {
  const windowMs = opts.windowSeconds * 1000;
  const windowStart = Math.floor(now.getTime() / windowMs) * windowMs;
  const expiresAt = new Date(windowStart + windowMs);
  const retryAfterSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000));
  try {
    const [{ count }] = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimitCounter" ("key", "count", "expiresAt")
      VALUES (${`${name}:${identifier}:${windowStart}`}, 1, ${expiresAt})
      ON CONFLICT ("key") DO UPDATE SET "count" = "RateLimitCounter"."count" + 1
      RETURNING "count"`;
    return { allowed: count <= opts.limit, remaining: Math.max(0, opts.limit - count), retryAfterSeconds };
  } catch (error) {
    console.error(`Rate limiter unavailable for ${name}; allowing request`, error);
    return { allowed: true, remaining: opts.limit, retryAfterSeconds: 0 };
  }
}

/** X-Forwarded-For is only trusted when the deployment sits behind a proxy that overwrites it.
 * Off by default: any client can send its own header, so trusting it would let one client pick a fresh
 * rate-limit key per request. Set TRUST_FORWARDED_FOR=true in environments behind the platform edge. */
export function trustForwardedFor(env: Record<string, string | undefined> = process.env): boolean {
  return env.TRUST_FORWARDED_FOR === "true";
}

/** The first X-Forwarded-For hop when the proxy is trusted; otherwise null. */
export function forwardedClientIp(headers: Pick<Headers, "get">, env: Record<string, string | undefined> = process.env): string | null {
  if (!trustForwardedFor(env)) return null;
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

/** The caller's IP for rate limiting. "unknown" (one shared bucket) when the proxy is not trusted. */
export function clientIp(request: Request, env: Record<string, string | undefined> = process.env): string {
  return forwardedClientIp(request.headers, env) ?? "unknown";
}

export function tooManyRequests(result: RateLimitResult): Response {
  return Response.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } });
}

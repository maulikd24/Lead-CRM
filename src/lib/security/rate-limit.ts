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

/** The caller's IP as Vercel reports it (first x-forwarded-for hop, which Vercel sets and overwrites). */
export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export function tooManyRequests(result: RateLimitResult): Response {
  return Response.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } });
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const getLiveCounts = vi.fn();
const rateLimit = vi.fn();
vi.mock("@/lib/security/rate-limit", () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a), tooManyRequests: (r: { retryAfterSeconds: number }) => Response.json({}, { status: 429, headers: { "Retry-After": String(r.retryAfterSeconds) } }) }));
vi.mock("@/lib/auth/config", () => ({ auth: () => auth() }));
vi.mock("@/lib/auth/visibility", () => ({ getVisibleUserIds: async (id: string) => [id] }));
vi.mock("@/lib/dashboard/live-counts", () => ({ getLiveCounts: (...a: unknown[]) => getLiveCounts(...a) }));

import { GET } from "./route";

describe("GET /api/dashboard/live-counts", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_MOTION", "1");
    rateLimit.mockResolvedValue({ allowed: true, remaining: 59, retryAfterSeconds: 0 });
    getLiveCounts.mockResolvedValue({ totals: { leads: 3, kyc: 1, funded: 0, activated: 0 }, newToday: 1, newestLeadAt: null, at: "x" });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("404s when the flag is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOTION", "");
    expect((await GET()).status).toBe(404);
  });
  it("401s without a session", async () => {
    auth.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });
  it("403s for roles outside the sales hierarchy", async () => {
    auth.mockResolvedValue({ user: { id: "u", role: "DEALER" } });
    expect((await GET()).status).toBe(403);
  });
  it("returns scoped counts for an RM, no store caching", async () => {
    auth.mockResolvedValue({ user: { id: "u1", role: "RM" } });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(getLiveCounts).toHaveBeenCalledWith(["u1"], "RM");
    expect(Object.keys(await res.json()).sort()).toEqual(["at", "newToday", "newestLeadAt", "totals"]);
  });
  it("429s with Retry-After when the per-user limit is hit", async () => {
    auth.mockResolvedValue({ user: { id: "u1", role: "RM" } });
    rateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 17 });
    const res = await GET();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("17");
    expect(rateLimit).toHaveBeenCalledWith("live-counts", "u1", { limit: 60, windowSeconds: 60 });
    expect(getLiveCounts).not.toHaveBeenCalled();
  });
});

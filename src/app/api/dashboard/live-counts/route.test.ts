import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const getLiveCounts = vi.fn();
vi.mock("@/lib/auth/config", () => ({ auth: () => auth() }));
vi.mock("@/lib/auth/visibility", () => ({ getVisibleUserIds: async (id: string) => [id] }));
vi.mock("@/lib/dashboard/live-counts", () => ({ getLiveCounts: (...a: unknown[]) => getLiveCounts(...a) }));

import { GET } from "./route";

describe("GET /api/dashboard/live-counts", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_MOTION", "1");
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
});

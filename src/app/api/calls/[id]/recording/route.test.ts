import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());

const db = vi.hoisted(() => ({ activity: { findFirst: vi.fn() }, user: { findMany: vi.fn() } }));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
const limiter = vi.hoisted(() => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/security/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/security/rate-limit")>()), rateLimit: limiter.rateLimit }));

import { GET } from "./route";

const fetchSpy = vi.fn();
const call = (over: { rmId?: string | null; recordingUrl?: string | null } = {}) => ({
  payload: { recordingUrl: over.recordingUrl === undefined ? "https://recordings.exotel.com/a/b.mp3" : over.recordingUrl, direction: "outbound", status: "completed", duration: 60 },
  userId: "rm-1",
  client: { assignedToId: "rm-1" },
  conversationReview: { assignedRmId: over.rmId === undefined ? "rm-1" : over.rmId },
});
const get = () => GET(new Request("http://localhost/api/calls/call-1/recording"), { params: Promise.resolve({ id: "call-1" }) });

beforeEach(() => {
  resetSession();
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_CALLS_REVIEW", "1");
  vi.stubGlobal("fetch", fetchSpy);
  fetchSpy.mockResolvedValue(new Response("audio-bytes", { status: 200, headers: { "content-type": "audio/mpeg" } }));
  limiter.rateLimit.mockResolvedValue({ allowed: true, remaining: 100, retryAfterSeconds: 0 });
  db.activity.findFirst.mockResolvedValue(call());
  db.user.findMany.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllGlobals());

describe("recording proxy: session and role gates (before any lookup)", () => {
  it("is a 404 while the flag is off, for everyone, before even reading the session", async () => {
    vi.stubEnv("NEXT_PUBLIC_CALLS_REVIEW", "");
    asUser({ role: "ADMIN" });
    expect((await get()).status).toBe(404);
    expect(db.activity.findFirst).not.toHaveBeenCalled();
  });
  it("is a 401 for a signed-out visitor", async () => {
    asAnonymous();
    expect((await get()).status).toBe(401);
    expect(db.activity.findFirst).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("is a 401 for a user who still has to change their password", async () => {
    asUser({ role: "ADMIN", mustChangePassword: true });
    expect((await get()).status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it.each(["DEALER", "PARTNER", "FINANCE", "TEAM_MANAGER", "AFFILIATE", "DISTRIBUTOR"] as const)("is a 404 for the %s role", async (role) => {
    asUser({ role });
    expect((await get()).status).toBe(404);
    expect(db.activity.findFirst).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("is a 429 when the per-user limit is hit, without a lookup", async () => {
    asUser({ role: "ADMIN" });
    limiter.rateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 30 });
    expect((await get()).status).toBe(429);
    expect(db.activity.findFirst).not.toHaveBeenCalled();
  });
});

describe("recording proxy: visibility", () => {
  it("is a 404 (the same as a missing call) for a call outside an RM's scope, and never fetches the recording", async () => {
    asUser({ id: "rm-2", role: "RM" });
    expect((await get()).status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("is a 404 for a manager when the call belongs to someone who does not report to them", async () => {
    asUser({ id: "mgr-1", role: "MANAGER" });
    expect((await get()).status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("streams the audio to the RM whose call it is", async () => {
    asUser({ id: "rm-1", role: "RM" });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.text()).toBe("audio-bytes");
    expect(fetchSpy.mock.calls[0][0]).toBe("https://recordings.exotel.com/a/b.mp3");
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ credentials: "omit", redirect: "manual" });
  });
  it("lets an admin hear any call", async () => {
    asUser({ id: "admin-1", role: "ADMIN" });
    expect((await get()).status).toBe(200);
  });
  it("scopes the lookup to CALL activities of live customers", async () => {
    asUser({ role: "ADMIN" });
    await get();
    expect(db.activity.findFirst.mock.calls[0][0].where).toMatchObject({ id: "call-1", type: "CALL", client: { isDeleted: false } });
  });
});

describe("recording proxy: what it will fetch", () => {
  it("is a 404 when the call has no recording", async () => {
    asUser({ role: "ADMIN" });
    db.activity.findFirst.mockResolvedValue(call({ recordingUrl: null }));
    expect((await get()).status).toBe(404);
  });
  it("refuses to fetch a recording URL on a host that is not allow-listed", async () => {
    asUser({ role: "ADMIN" });
    db.activity.findFirst.mockResolvedValue(call({ recordingUrl: "https://evil.example.net/x.mp3" }));
    expect((await get()).status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

import crypto from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  rate: vi.fn(async () => ({ allowed: true, remaining: 1, retryAfterSeconds: 0 })),
  lookup: vi.fn(async (ids: unknown[]) => ids.map(() => ({ clientCode: ["client-1"] }))),
  audit: vi.fn(async () => {}),
  repo: {
    findAccounts: vi.fn(async () => new Map()),
    ensureAccount: vi.fn(async () => ({ id: "a1", clientId: "client-1" })),
    findProducts: vi.fn(async () => new Map()),
    ensureProduct: vi.fn(async () => ({ id: "p1" })),
    findPositions: vi.fn(async () => new Map()),
    createPosition: vi.fn(async () => {}),
    updatePosition: vi.fn(async () => {}),
    findTransactions: vi.fn(async () => new Map()),
    createTransaction: vi.fn(async () => {}),
    updateTransaction: vi.fn(async () => {}),
  },
}));

vi.mock("@/lib/security/rate-limit", () => ({
  rateLimit: m.rate,
  clientIp: () => "127.0.0.1",
  tooManyRequests: () => Response.json({ error: "Too many requests" }, { status: 429 }),
}));
vi.mock("@/lib/portfolio-feed/prisma-repo", () => ({ lookupCustomers: m.lookup, auditBatch: m.audit, prismaFeedRepo: m.repo }));

import { POST } from "./route";

const SECRET = "route-secret";
const body = JSON.stringify({ version: 1, batchId: "b-1", customers: [{ customer: { clientCode: "CL-1" }, holdings: [{ accountNumber: "A", productCode: "P", quantity: 1, asOfDate: "2026-10-08", revision: 1 }] }] });
const sign = (ts: string, raw: string) => crypto.createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex");
const nowTs = () => String(Math.floor(Date.now() / 1000));

function req(raw: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/ingest/portfolio", { method: "POST", body: raw, headers });
}
function signed(raw: string, over: { ts?: string; sig?: string } = {}) {
  const ts = over.ts ?? nowTs();
  return req(raw, { "x-timestamp": ts, "x-signature": over.sig ?? sign(ts, raw) });
}
const untouched = () => {
  expect(m.lookup).not.toHaveBeenCalled();
  for (const fn of Object.values(m.repo)) expect(fn).not.toHaveBeenCalled();
  expect(m.audit).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PORTFOLIO_FEED_ENABLED", "1");
  vi.stubEnv("PORTFOLIO_FEED_SECRET", SECRET);
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/ingest/portfolio", () => {
  it("is 404 when the flag is off or the secret is unset, before reading anything", async () => {
    vi.stubEnv("PORTFOLIO_FEED_ENABLED", "0");
    expect((await POST(signed(body))).status).toBe(404);
    vi.stubEnv("PORTFOLIO_FEED_ENABLED", "1");
    vi.stubEnv("PORTFOLIO_FEED_SECRET", "");
    expect((await POST(signed(body))).status).toBe(404);
    untouched();
  });

  it("is 429 when rate limited", async () => {
    m.rate.mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 5 });
    expect((await POST(signed(body))).status).toBe(429);
    untouched();
  });

  it("accepts a valid signed request and writes through the repo", async () => {
    const res = await POST(signed(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ version: 1, batchId: "b-1", counts: { customers: { matched: 1 }, holdings: { created: 1 } } });
    expect(m.repo.createPosition).toHaveBeenCalledTimes(1);
    expect(m.audit).toHaveBeenCalledTimes(1);
  });

  it("accepts the sha256= prefix", async () => {
    const ts = nowTs();
    expect((await POST(req(body, { "x-timestamp": ts, "x-signature": `sha256=${sign(ts, body)}` }))).status).toBe(200);
  });

  it("answers 401 BEFORE 400: a bad signature with invalid JSON is 401, and nothing is touched", async () => {
    const res = await POST(signed("{not json", { sig: "deadbeef" }));
    expect(res.status).toBe(401);
    untouched();
  });

  it("401 for a missing signature, a missing timestamp, and a body-only signature; nothing is touched", async () => {
    expect((await POST(req(body))).status).toBe(401);
    expect((await POST(req(body, { "x-signature": sign(nowTs(), body) }))).status).toBe(401);
    const bodyOnly = crypto.createHmac("sha256", SECRET).update(body).digest("hex");
    expect((await POST(req(body, { "x-timestamp": nowTs(), "x-signature": bodyOnly }))).status).toBe(401);
    untouched();
  });

  it("rejects a correctly signed but stale timestamp, and a replay of an old capture", async () => {
    const old = String(Math.floor(Date.now() / 1000) - 600);
    const res = await POST(signed(body, { ts: old }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/Timestamp/);
    untouched();
  });

  it("400 for malformed JSON once authenticated; 422 for a bad envelope", async () => {
    expect((await POST(signed("{not json"))).status).toBe(400);
    const bad = JSON.stringify({ version: 2, batchId: "x", customers: [] });
    const res = await POST(signed(bad));
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).not.toContain("batchId\":\"x");
    untouched();
  });

  it("413 for an oversized body, before authentication", async () => {
    const big = "x".repeat(2_000_001);
    const res = await POST(signed(big));
    expect(res.status).toBe(413);
    untouched();
  });

  it("207 with unmatched customers, and a generic 500 (no detail) when the lookup fails", async () => {
    m.lookup.mockResolvedValueOnce([{ clientCode: [] }]);
    const res = await POST(signed(body));
    expect(res.status).toBe(207);
    expect(await res.json()).toMatchObject({ counts: { customers: { unmatched: 1 } } });

    m.lookup.mockRejectedValueOnce(new Error("password=hunter2 at db.internal"));
    const err = await POST(signed(body));
    expect(err.status).toBe(500);
    expect(JSON.stringify(await err.json())).toBe('{"error":"Could not process batch"}');
  });
});

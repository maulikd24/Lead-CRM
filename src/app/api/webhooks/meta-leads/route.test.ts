import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const APP_SECRET = "APP-SECRET-VALUE-do-not-log";
const VERIFY_TOKEN = "VERIFY-TOKEN-VALUE";
const PAGE_TOKEN = "PAGE-TOKEN-VALUE";

const config = { live: true, allowedOrigins: [] as string[], metaAppSecret: APP_SECRET, metaVerifyToken: VERIFY_TOKEN, metaPageToken: PAGE_TOKEN };
const handle = vi.fn(async () => ({ status: "created", clientId: "c1" }) as const);

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/leads/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/leads/config")>()),
  getLeadIntakeConfig: vi.fn(async () => config),
}));
vi.mock("@/lib/leads/meta", () => ({
  handleLeadgenChange: (...args: unknown[]) => (handle as unknown as (...a: unknown[]) => unknown)(...args),
  NO_CONSENT_REASON: "No consent: the form's consent checkbox was not answered yes",
}));
vi.mock("@/lib/security/rate-limit", () => ({
  clientIp: () => "203.0.113.5",
  rateLimit: async () => ({ allowed: true }),
  tooManyRequests: () => new Response(null, { status: 429 }),
}));
vi.mock("@/lib/system/job-registry", () => ({ jobSpec: () => ({ id: "webhook:meta-leads" }) }));
vi.mock("@/lib/system/with-run-record", () => ({ withRunRecord: (_spec: unknown, h: unknown) => h }));

import { GET, POST } from "./route";

const body = JSON.stringify({ entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "L-1", page_id: "P", form_id: "F" } }] }] });
const sign = (raw: string, secret = APP_SECRET) => "sha256=" + crypto.createHmac("sha256", secret).update(raw, "utf8").digest("hex");
const post = (raw: string, headers: Record<string, string> = {}) => new Request("https://app.test/api/webhooks/meta-leads", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw });

let logged: string[] = [];
beforeEach(() => {
  vi.stubEnv("META_LEAD_ADS_ENABLED", "1");
  vi.stubEnv("META_APP_SECRET", "");
  vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "");
  handle.mockClear();
  logged = [];
  for (const m of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(" ")); });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("verify challenge", () => {
  it("echoes the challenge when the verify token matches", async () => {
    const res = await GET(new Request(`https://app.test/api/webhooks/meta-leads?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=12345`));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("12345");
  });

  it("refuses a wrong verify token", async () => {
    const res = await GET(new Request("https://app.test/api/webhooks/meta-leads?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1"));
    expect(res.status).toBe(403);
  });
});

describe("signature", () => {
  it("accepts a valid X-Hub-Signature-256 and hands each leadgen event to the handler", async () => {
    const res = await POST(post(body, { "x-hub-signature-256": sign(body) }));
    expect(res.status).toBe(200);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ leadgen_id: "L-1" }), PAGE_TOKEN);
  });

  it("refuses an invalid signature before parsing anything", async () => {
    const res = await POST(post(body, { "x-hub-signature-256": sign(body, "wrong-secret") }));
    expect(res.status).toBe(401);
    expect(handle).not.toHaveBeenCalled();
  });

  it("refuses a missing signature", async () => {
    const res = await POST(post(body));
    expect(res.status).toBe(401);
    expect(handle).not.toHaveBeenCalled();
  });
});

describe("gates", () => {
  it("is not there while META_LEAD_ADS_ENABLED is not 1", async () => {
    vi.stubEnv("META_LEAD_ADS_ENABLED", "0");
    expect((await POST(post(body, { "x-hub-signature-256": sign(body) }))).status).toBe(404);
    expect((await GET(new Request(`https://app.test/api/webhooks/meta-leads?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1`))).status).toBe(404);
  });

  it("refuses to run without the verify token or the app secret", async () => {
    const noSecret = { ...config, metaAppSecret: undefined };
    const { getLeadIntakeConfig } = await import("@/lib/leads/config");
    vi.mocked(getLeadIntakeConfig).mockResolvedValueOnce(noSecret as never);
    expect((await POST(post(body, { "x-hub-signature-256": sign(body) }))).status).toBe(404);
    const noToken = { ...config, metaVerifyToken: undefined };
    vi.mocked(getLeadIntakeConfig).mockResolvedValueOnce(noToken as never);
    expect((await GET(new Request("https://app.test/api/webhooks/meta-leads?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1"))).status).toBe(404);
  });

  it("counts consent drops in the response, without the names or contact details", async () => {
    handle.mockResolvedValueOnce({ status: "rejected", reason: "No consent: the form's consent checkbox was not answered yes" } as never);
    const res = await POST(post(body, { "x-hub-signature-256": sign(body) }));
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toEqual({ ok: true, parkedForRetry: 0, droppedNoConsent: 1 });
  });
});

describe("secrets never reach the logs", () => {
  it("logs nothing that contains the app secret, the verify token or the page token", async () => {
    await POST(post(body, { "x-hub-signature-256": sign(body, "wrong-secret") }));
    await POST(post(body, { "x-hub-signature-256": sign(body) }));
    await GET(new Request(`https://app.test/api/webhooks/meta-leads?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1`));
    const all = logged.join("\n");
    for (const secret of [APP_SECRET, VERIFY_TOKEN, PAGE_TOKEN]) expect(all).not.toContain(secret);
  });
});

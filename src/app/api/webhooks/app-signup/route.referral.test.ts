import { beforeEach, describe, expect, it, vi } from "vitest";

const ingestLead = vi.fn();
const attributeAfterIngest = vi.fn();
vi.mock("@/lib/leads/ingest", () => ({ ingestLead: (...a: unknown[]) => ingestLead(...a) }));
vi.mock("@/lib/referrals/webhook", () => ({ attributeAfterIngest: (...a: unknown[]) => attributeAfterIngest(...a) }));
vi.mock("@/lib/security/rate-limit", () => ({ clientIp: () => "1.1.1.1", rateLimit: async () => ({ allowed: true }), tooManyRequests: () => new Response("", { status: 429 }) }));
vi.mock("@/lib/security/webhook-auth", () => ({ verifyHmacSha256: () => true }));

import { POST } from "./route";

const body = (extra: Record<string, unknown> = {}) =>
  new Request("http://localhost/api/webhooks/app-signup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature": "x" },
    body: JSON.stringify({ userId: "u-1", name: "Test Person", mobile: "9800000002", consentAt: new Date().toISOString(), ...extra }),
  });

beforeEach(() => {
  process.env.APP_SIGNUP_SECRET = "s";
  ingestLead.mockReset().mockResolvedValue({ status: "created", clientId: "cN" });
  attributeAfterIngest.mockReset().mockResolvedValue({ status: "attributed" });
});

describe("app-signup webhook and the referral hook", () => {
  it("hands the validated contract and the outcome to the referral hook, and the response is unchanged", async () => {
    const res = await POST(body({ referralCode: "ABCD-2345" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "created" });
    expect(attributeAfterIngest).toHaveBeenCalledTimes(1);
    expect(attributeAfterIngest.mock.calls[0][0]).toMatchObject({ contract: { userId: "u-1", referralCode: "ABCD-2345" }, outcome: { status: "created", clientId: "cN" } });
  });
  it("a rejected signup is still answered as before", async () => {
    ingestLead.mockResolvedValue({ status: "rejected", reason: "No valid phone" });
    expect((await POST(body())).status).toBe(422);
  });
});

import { describe, expect, it } from "vitest";

import type { OutboundEvent } from "../types";
import { createGoogleOfflineDestination, type GoogleOfflineConfig } from "./google-offline";
import type { FetchLike } from "./meta-capi";

const H = "ab".repeat(32);
const ev = (o: Partial<OutboundEvent> = {}): OutboundEvent => ({ dedupId: "cl1_x", eventType: "KYC_COMPLETE", qualifier: "", occurredAt: new Date("2027-03-19T10:30:00Z"), identity: { hashedEmail: H, hashedPhone: "cd".repeat(32), gclid: "G-click" }, value: null, ...o });
const CONFIG: GoogleOfflineConfig = {
  customerId: "123-456-7890", loginCustomerId: "987-654-3210", developerToken: "DEVTOKEN-secret", clientId: "cid", clientSecret: "CSECRET", refreshToken: "RTOKEN-secret",
  conversionActions: { KYC_COMPLETE: "111", FIRST_FUNDING: "222" }, apiVersion: "v22",
};

type Call = { url: string; headers: Record<string, string>; body: string | undefined };
function fakeFetch(handlers: { token?: { status: number; json?: unknown }; upload?: { status: number; json?: unknown } } = {}) {
  const calls: Call[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers ?? {}, body: init.body });
    const h = url.includes("oauth2") ? (handlers.token ?? { status: 200, json: { access_token: "ACCESS-secret", expires_in: 3600 } }) : (handlers.upload ?? { status: 200, json: { results: [{}] } });
    return { status: h.status, ok: h.status < 300, json: async () => h.json ?? {} };
  };
  return { fn, calls };
}

describe("Google Ads offline conversions destination", () => {
  it("refreshes a token, then uploads in the documented shape with the dedup id as order id", async () => {
    const f = fakeFetch();
    const d = createGoogleOfflineDestination({ config: CONFIG, fetch: f.fn });
    const res = await d.send([ev({ eventType: "FIRST_FUNDING", value: 120000 })]);
    expect(res).toEqual([{ dedupId: "cl1_x", outcome: "sent" }]);
    expect(f.calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(f.calls[0].body).toContain("grant_type=refresh_token");
    expect(f.calls[1].url).toBe("https://googleads.googleapis.com/v22/customers/1234567890:uploadClickConversions");
    expect(f.calls[1].headers).toMatchObject({ authorization: "Bearer ACCESS-secret", "developer-token": "DEVTOKEN-secret", "login-customer-id": "9876543210" });
    const body = JSON.parse(f.calls[1].body!);
    expect(body.partialFailure).toBe(true);
    expect(body.conversions[0]).toEqual({
      conversionAction: "customers/1234567890/conversionActions/222",
      conversionDateTime: "2027-03-19 10:30:00+00:00",
      orderId: "cl1_x",
      gclid: "G-click",
      userIdentifiers: [{ hashedEmail: H }, { hashedPhoneNumber: "cd".repeat(32) }],
      conversionValue: 120000,
      currencyCode: "INR",
      consent: { adUserData: "GRANTED", adPersonalization: "GRANTED" },
    });
  });
  it("reuses the access token within a batch run and omits absent identifiers and value", async () => {
    const f = fakeFetch({ upload: { status: 200, json: { results: [{}, {}] } } });
    const d = createGoogleOfflineDestination({ config: CONFIG, fetch: f.fn });
    await d.send([ev({ dedupId: "a", identity: { hashedEmail: H } }), ev({ dedupId: "b", identity: { gclid: "G" } })]);
    await d.send([ev({ dedupId: "c" })]);
    expect(f.calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(1);
    const first = JSON.parse(f.calls[1].body!).conversions;
    expect(first[0]).not.toHaveProperty("gclid");
    expect(first[0]).not.toHaveProperty("conversionValue");
    expect(first[1]).not.toHaveProperty("userIdentifiers");
  });
  it("an event type with no conversion action configured is rejected without calling Google for it", async () => {
    const f = fakeFetch();
    const res = await createGoogleOfflineDestination({ config: CONFIG, fetch: f.fn }).send([ev({ eventType: "AUM_BAND", qualifier: "50L" })]);
    expect(res).toEqual([{ dedupId: "cl1_x", outcome: "rejected", errorCode: "no_conversion_action" }]);
    expect(f.calls).toHaveLength(0);
  });
  it("partial failure: the failed index is rejected or retried by its error, the rest are sent", async () => {
    const f = fakeFetch({
      upload: {
        status: 200,
        json: {
          results: [{}, {}, {}],
          partialFailureError: { details: [{ errors: [
            { errorCode: { conversionUploadError: "UNPARSEABLE_GCLID" }, location: { fieldPathElements: [{ fieldName: "conversions", index: 1 }] }, message: "contains a raw email a@b.com" },
            { errorCode: { internalError: "INTERNAL_ERROR" }, location: { fieldPathElements: [{ fieldName: "conversions", index: 2 }] } },
          ] }] },
        },
      },
    });
    const res = await createGoogleOfflineDestination({ config: CONFIG, fetch: f.fn }).send([ev({ dedupId: "a" }), ev({ dedupId: "b" }), ev({ dedupId: "c" })]);
    expect(res).toEqual([
      { dedupId: "a", outcome: "sent" },
      { dedupId: "b", outcome: "rejected", errorCode: "upload_rejected" },
      { dedupId: "c", outcome: "retry", errorCode: "transient_error" },
    ]);
    expect(JSON.stringify(res)).not.toContain("a@b.com");
  });
  it("HTTP failures map to retry or rejected with short codes, and no credential ever appears in a result", async () => {
    for (const [status, outcome, code] of [[500, "retry", "http_500"], [429, "retry", "rate_limited"], [401, "retry", "auth_error"], [400, "rejected", "invalid_request"]] as const) {
      const f = fakeFetch({ upload: { status, json: { error: { message: "DEVTOKEN-secret leaked" } } } });
      const [r] = await createGoogleOfflineDestination({ config: CONFIG, fetch: f.fn }).send([ev()]);
      expect(r, String(status)).toMatchObject({ outcome, errorCode: code });
      expect(JSON.stringify(r)).not.toMatch(/secret/i);
    }
  });
  it("a failed token refresh is a retry (auth_error), and the upload is not attempted", async () => {
    const f = fakeFetch({ token: { status: 400, json: { error: "invalid_grant" } } });
    const [r] = await createGoogleOfflineDestination({ config: CONFIG, fetch: f.fn }).send([ev()]);
    expect(r).toMatchObject({ outcome: "retry", errorCode: "auth_error" });
    expect(f.calls).toHaveLength(1);
  });
  it("declares its batch size and accepted age", () => {
    expect(createGoogleOfflineDestination({ config: CONFIG, fetch: fakeFetch().fn })).toMatchObject({ key: "google_ads", platform: "google", maxBatch: 200, maxEventAgeDays: 90 });
  });
});

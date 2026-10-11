import { describe, expect, it } from "vitest";

import type { OutboundEvent } from "../types";
import { createMetaCapiDestination, type FetchLike } from "./meta-capi";

const H = "ab".repeat(32);
const ev = (o: Partial<OutboundEvent> = {}): OutboundEvent => ({ dedupId: "cl1_x", eventType: "KYC_COMPLETE", qualifier: "", occurredAt: new Date("2027-03-19T10:00:00Z"), identity: { hashedEmail: H, hashedPhone: "cd".repeat(32), fbp: "fb.1.1.2", fbc: "fb.1.1.IwAR" }, value: null, ...o });
const CONFIG = { pixelId: "1234567890", accessToken: "SECRET-TOKEN-xyz", apiVersion: "v21.0" };

function fakeFetch(respond: (url: string, init: { body?: string; headers?: Record<string, string> }) => { status: number; json?: unknown }) {
  const calls: { url: string; body: Record<string, unknown> | null; headers: Record<string, string> }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null, headers: init.headers ?? {} });
    const r = respond(url, init);
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.json ?? {} };
  };
  return { fn, calls };
}

describe("Meta Conversions API destination", () => {
  it("posts to the pixel's events endpoint in the documented shape", async () => {
    const f = fakeFetch(() => ({ status: 200, json: { events_received: 1, fbtrace_id: "t" } }));
    const d = createMetaCapiDestination({ config: CONFIG, fetch: f.fn });
    const res = await d.send([ev({ value: 120000, eventType: "FIRST_FUNDING" })]);
    expect(res).toEqual([{ dedupId: "cl1_x", outcome: "sent" }]);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe("https://graph.facebook.com/v21.0/1234567890/events");
    const body = f.calls[0].body as { access_token: string; data: Record<string, unknown>[] };
    expect(body.access_token).toBe("SECRET-TOKEN-xyz");
    expect(body.data[0]).toEqual({
      event_name: "FirstFunding",
      event_time: Math.floor(Date.parse("2027-03-19T10:00:00Z") / 1000),
      event_id: "cl1_x",
      action_source: "system_generated",
      user_data: { em: [H], ph: ["cd".repeat(32)], fbp: "fb.1.1.2", fbc: "fb.1.1.IwAR" },
      custom_data: { value: 120000, currency: "INR" },
    });
  });
  it("custom data carries the assets band for AUM events and nothing for KYC", async () => {
    const f = fakeFetch(() => ({ status: 200, json: { events_received: 2 } }));
    await createMetaCapiDestination({ config: CONFIG, fetch: f.fn }).send([ev({ eventType: "AUM_BAND", qualifier: "50L", dedupId: "a" }), ev({ dedupId: "b" })]);
    const data = (f.calls[0].body as { data: Record<string, unknown>[] }).data;
    expect(data[0].custom_data).toEqual({ aum_band: "50L" });
    expect(data[1].custom_data).toBeUndefined();
  });
  it("sends the test event code only when configured", async () => {
    const f = fakeFetch(() => ({ status: 200, json: { events_received: 1 } }));
    await createMetaCapiDestination({ config: { ...CONFIG, testEventCode: "TEST123" }, fetch: f.fn }).send([ev()]);
    expect((f.calls[0].body as Record<string, unknown>).test_event_code).toBe("TEST123");
    const g = fakeFetch(() => ({ status: 200, json: { events_received: 1 } }));
    await createMetaCapiDestination({ config: CONFIG, fetch: g.fn }).send([ev()]);
    expect("test_event_code" in (g.calls[0].body as object)).toBe(false);
  });
  it("omits identifier fields that are absent", async () => {
    const f = fakeFetch(() => ({ status: 200, json: { events_received: 1 } }));
    await createMetaCapiDestination({ config: CONFIG, fetch: f.fn }).send([ev({ identity: { hashedEmail: H } })]);
    expect((f.calls[0].body as { data: { user_data: unknown }[] }).data[0].user_data).toEqual({ em: [H] });
  });
  it("fewer events received than sent is a retry for the batch (the event id makes the resend safe)", async () => {
    const f = fakeFetch(() => ({ status: 200, json: { events_received: 1 } }));
    const res = await createMetaCapiDestination({ config: CONFIG, fetch: f.fn }).send([ev({ dedupId: "a" }), ev({ dedupId: "b" })]);
    expect(res.every((r) => r.outcome === "retry" && r.errorCode === "partial_receipt")).toBe(true);
  });
  it("maps failures to retry or rejected with short codes and never leaks the token or the body", async () => {
    const cases: [number, unknown, string, string][] = [
      [500, {}, "retry", "http_500"],
      [429, {}, "retry", "rate_limited"],
      [400, { error: { code: 100, message: "Invalid parameter SECRET-TOKEN-xyz" } }, "rejected", "invalid_parameter"],
      [400, { error: { code: 190, message: "token expired" } }, "retry", "auth_error"],
      [401, {}, "retry", "auth_error"],
      [400, { error: { code: 4, message: "too many calls" } }, "retry", "rate_limited"],
    ];
    for (const [status, json, outcome, code] of cases) {
      const f = fakeFetch(() => ({ status, json }));
      const [r] = await createMetaCapiDestination({ config: CONFIG, fetch: f.fn }).send([ev()]);
      expect(r, `${status}`).toMatchObject({ outcome, errorCode: code });
      expect(JSON.stringify(r)).not.toContain("SECRET");
    }
    const f = fakeFetch(() => ({ status: 429, json: {} }));
    expect((await createMetaCapiDestination({ config: CONFIG, fetch: f.fn }).send([ev()]))[0].retryAfterMs).toBeGreaterThan(0);
  });
  it("a network exception propagates for the engine to turn into a retry", async () => {
    const d = createMetaCapiDestination({ config: CONFIG, fetch: async () => { throw new Error("boom"); } });
    await expect(d.send([ev()])).rejects.toThrow();
  });
  it("declares what the engine needs: a batch size and the age Meta accepts", () => {
    const d = createMetaCapiDestination({ config: CONFIG, fetch: async () => ({ status: 200, ok: true, json: async () => ({}) }) });
    expect(d).toMatchObject({ key: "meta_capi", platform: "meta", maxBatch: 1000, maxEventAgeDays: 7 });
  });
});

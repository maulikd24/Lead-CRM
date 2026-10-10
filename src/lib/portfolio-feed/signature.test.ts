import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyFeedSignature } from "./signature";

const secret = "s3cret";
const now = Date.parse("2026-10-09T12:00:00Z");
const ts = String(Math.floor(now / 1000));
const sign = (t: string, body: string) => crypto.createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex");
const check = (over: Partial<Parameters<typeof verifyFeedSignature>[0]> = {}) => verifyFeedSignature({ secret, timestamp: ts, signature: sign(ts, "{}"), rawBody: "{}", nowMs: now, ...over });

describe("verifyFeedSignature", () => {
  it("accepts a fresh, correctly signed request, with or without the sha256= prefix", () => {
    expect(check()).toBe("ok");
    expect(check({ signature: `sha256=${sign(ts, "{}")}` })).toBe("ok");
  });
  it("rejects a missing or malformed timestamp or signature", () => {
    expect(check({ timestamp: null })).toBe("invalid");
    expect(check({ timestamp: "abc" })).toBe("invalid");
    expect(check({ signature: null })).toBe("invalid");
    expect(check({ signature: "deadbeef" })).toBe("invalid");
  });
  it("the timestamp is part of what is signed: a body-only signature or a swapped timestamp fails", () => {
    expect(check({ signature: crypto.createHmac("sha256", secret).update("{}").digest("hex") })).toBe("invalid");
    expect(check({ timestamp: String(Number(ts) + 1) })).toBe("invalid");
  });
  it("refuses a correctly signed request more than 5 minutes off, in either direction", () => {
    const old = String(Number(ts) - 301);
    expect(check({ timestamp: old, signature: sign(old, "{}") })).toBe("stale");
    const future = String(Number(ts) + 301);
    expect(check({ timestamp: future, signature: sign(future, "{}") })).toBe("stale");
    const edge = String(Number(ts) - 300);
    expect(check({ timestamp: edge, signature: sign(edge, "{}") })).toBe("ok");
  });
  it("fails closed without a secret", () => expect(check({ secret: "" })).toBe("invalid"));
});

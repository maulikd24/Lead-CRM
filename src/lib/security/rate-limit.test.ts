import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

import { clientIp, forwardedClientIp, trustForwardedFor } from "./rate-limit";

const spoofed = new Request("https://app.example/api/x", { headers: { "x-forwarded-for": "6.6.6.6, 10.0.0.1" } });

describe("client IP trust", () => {
  it("does not trust X-Forwarded-For by default, so a client cannot choose its rate-limit key", () => {
    expect(trustForwardedFor({})).toBe(false);
    expect(clientIp(spoofed, {})).toBe("unknown");
    expect(forwardedClientIp(spoofed.headers, {})).toBeNull();
  });

  it("only the exact value true turns trust on", () => {
    expect(trustForwardedFor({ TRUST_FORWARDED_FOR: "1" })).toBe(false);
    expect(trustForwardedFor({ TRUST_FORWARDED_FOR: "TRUE" })).toBe(false);
    expect(trustForwardedFor({ TRUST_FORWARDED_FOR: "true" })).toBe(true);
  });

  it("with the flag on, uses the first hop and ignores the rest", () => {
    const env = { TRUST_FORWARDED_FOR: "true" };
    expect(clientIp(spoofed, env)).toBe("6.6.6.6");
    expect(forwardedClientIp(spoofed.headers, env)).toBe("6.6.6.6");
  });

  it("with the flag on but no header, falls back to unknown rather than trusting x-real-ip", () => {
    const req = new Request("https://app.example/api/x", { headers: { "x-real-ip": "7.7.7.7" } });
    expect(clientIp(req, { TRUST_FORWARDED_FOR: "true" })).toBe("unknown");
  });
});

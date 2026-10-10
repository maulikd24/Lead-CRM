import { describe, expect, it } from "vitest";

import { resolvePartnerSource, sampleAllowed } from "./source";

describe("resolvePartnerSource", () => {
  it("is native by default, so the workspace needs no external key", () => {
    expect(resolvePartnerSource({})).toBe("native");
    expect(resolvePartnerSource({ PARTNER_SOURCE: "" })).toBe("native");
    expect(resolvePartnerSource({ PARTNER_SOURCE: "native" })).toBe("native");
  });
  it("keeps the sample source for development", () => {
    expect(resolvePartnerSource({ PARTNER_SOURCE: "sample" })).toBe("sample");
    expect(resolvePartnerSource({ PARTNER_SOURCE: "  Sample " })).toBe("sample");
  });
  it("no longer has an external source: the retired value reads this CRM, never the network", () => {
    expect(resolvePartnerSource({ PARTNER_SOURCE: "external" })).toBe("native");
    expect(resolvePartnerSource({ PARTNER_SOURCE: "  External " })).toBe("native");
  });
  it("treats any unknown value as native", () => {
    expect(resolvePartnerSource({ PARTNER_SOURCE: "extrenal" })).toBe("native");
  });
});

describe("sampleAllowed", () => {
  it("is allowed outside production", () => {
    expect(sampleAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(sampleAllowed({})).toBe(true);
  });
  it("is refused in production unless PARTNER_ALLOW_SAMPLE=1 says so", () => {
    expect(sampleAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(sampleAllowed({ NODE_ENV: "production", PARTNER_ALLOW_SAMPLE: "true" })).toBe(false);
    expect(sampleAllowed({ NODE_ENV: "production", PARTNER_ALLOW_SAMPLE: "1" })).toBe(true);
  });
});

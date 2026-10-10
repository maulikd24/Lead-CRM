import { describe, expect, it } from "vitest";

import { resolvePartnerSource } from "./source";

describe("resolvePartnerSource", () => {
  it("is native by default, so the workspace needs no external key", () => {
    expect(resolvePartnerSource({})).toBe("native");
    expect(resolvePartnerSource({ PARTNER_SOURCE: "" })).toBe("native");
    expect(resolvePartnerSource({ PARTNER_SOURCE: "native" })).toBe("native");
  });
  it("keeps the external adapter selectable", () => {
    expect(resolvePartnerSource({ PARTNER_SOURCE: "external" })).toBe("external");
  });
  it("keeps the sample source for development", () => {
    expect(resolvePartnerSource({ PARTNER_SOURCE: "sample" })).toBe("sample");
  });
  it("ignores case and spaces", () => {
    expect(resolvePartnerSource({ PARTNER_SOURCE: "  External " })).toBe("external");
  });
  it("treats an unknown value as native, the source that makes no network call", () => {
    expect(resolvePartnerSource({ PARTNER_SOURCE: "extrenal" })).toBe("native");
  });
});

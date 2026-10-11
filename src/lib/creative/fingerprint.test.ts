import { describe, expect, it } from "vitest";

import { copyFingerprint } from "./fingerprint";

describe("copyFingerprint (the annexure's fingerprint of the exact approved text)", () => {
  const base = { format: "meta_feed", fields: { headline: ["Learn about SIPs"] }, disclaimer: "Risk line." };
  it("is stable: the same copy gives the same 16 hex characters", () => {
    expect(copyFingerprint(base)).toMatch(/^[0-9a-f]{16}$/);
    expect(copyFingerprint(base)).toBe(copyFingerprint({ ...base }));
  });
  it("changes when any word of the copy, the format or the disclaimer changes", () => {
    const f = copyFingerprint(base);
    expect(copyFingerprint({ ...base, fields: { headline: ["Learn about SIP"] } })).not.toBe(f);
    expect(copyFingerprint({ ...base, format: "google_rsa" })).not.toBe(f);
    expect(copyFingerprint({ ...base, disclaimer: "Risk line" })).not.toBe(f);
  });
});

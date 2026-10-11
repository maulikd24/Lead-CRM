import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { pseudonymize } from "@/lib/access/pseudonym";

import { analyticsPseudonym, eventDedupDigest, vendorMatchHash } from "./pseudonym";

describe("purpose-bound hashing: one module, three purposes", () => {
  it("vendorMatchHash is the plain SHA-256 hex of the already-normalised value (the ad platforms match on exactly this; keying it would break matching)", () => {
    expect(vendorMatchHash("asha@example.com")).toBe(createHash("sha256").update("asha@example.com", "utf8").digest("hex"));
    expect(vendorMatchHash("asha@example.com")).toMatch(/^[0-9a-f]{64}$/);
    expect(vendorMatchHash("a")).not.toBe(vendorMatchHash("b"));
  });
  it("analyticsPseudonym is the keyed stand-in the access module uses on screens (same value, so a screen and a report agree)", () => {
    expect(analyticsPseudonym("c1", "secret")).toBe(pseudonymize("c1", "secret"));
    expect(analyticsPseudonym("c1", "secret")).not.toBe(analyticsPseudonym("c1", "other"));
    expect(analyticsPseudonym("c1", "secret")).toMatch(/^P-[0-9a-f]{10}$/);
  });
  it("eventDedupDigest is stable and namespaced: the same parts always give the same id, different namespaces never collide", () => {
    expect(eventDedupDigest("cl1", ["c1", "KYC_COMPLETE", ""])).toBe(eventDedupDigest("cl1", ["c1", "KYC_COMPLETE", ""]));
    expect(eventDedupDigest("cl1", ["c1", "KYC_COMPLETE", ""])).not.toBe(eventDedupDigest("zz", ["c1", "KYC_COMPLETE", ""]));
    expect(eventDedupDigest("cl1", ["c1", "KYC_COMPLETE", ""])).toMatch(/^cl1_[0-9a-f]{32}$/);
  });
  it("the three purposes never produce the same value for the same input", () => {
    const v = "c1";
    expect(new Set([vendorMatchHash(v), analyticsPseudonym(v, "s"), eventDedupDigest("cl1", [v])]).size).toBe(3);
  });
});

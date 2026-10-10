import { describe, expect, it } from "vitest";

import { FLAG_LABEL, fraudFlags, type FraudInput } from "./fraud";

const p = (over: Partial<{ clientId: string; phoneKey: string | null; emailKey: string | null; pan: string | null }> = {}) => ({ clientId: "c", phoneKey: null, emailKey: null, pan: null, ...over });
const input = (over: Partial<FraudInput> = {}): FraudInput => ({
  referrer: p({ clientId: "R", phoneKey: "9800000001", emailKey: "r@example.test", pan: "AAAAA1111A" }),
  referred: p({ clientId: "N", phoneKey: "9800000002", emailKey: "n@example.test", pan: "BBBBB2222B" }),
  siblings: [],
  attributionsLast24h: 1,
  velocityLimit: 5,
  capped: false,
  ...over,
});

describe("fraudFlags", () => {
  it("is clean for an ordinary referral", () => expect(fraudFlags(input())).toEqual([]));
  it("flags velocity above the limit, not at it", () => {
    expect(fraudFlags(input({ attributionsLast24h: 5 }))).toEqual([]);
    expect(fraudFlags(input({ attributionsLast24h: 6 }))).toEqual(["VELOCITY"]);
  });
  it("flags a referred person who shares a key with the referrer", () => {
    expect(fraudFlags(input({ referred: p({ clientId: "N", phoneKey: "9800000001" }) }))).toContain("SHARES_PHONE_WITH_REFERRER");
    expect(fraudFlags(input({ referred: p({ clientId: "N", emailKey: "r@example.test" }) }))).toContain("SHARES_EMAIL_WITH_REFERRER");
    expect(fraudFlags(input({ referred: p({ clientId: "N", pan: "AAAAA1111A" }) }))).toContain("SHARES_PAN_WITH_REFERRER");
  });
  it("flags collisions between the referrer's referred people", () => {
    const sib = p({ clientId: "S", phoneKey: "9800000002", emailKey: "n@example.test", pan: "BBBBB2222B" });
    expect(fraudFlags(input({ siblings: [sib] })).sort()).toEqual(["SIBLING_EMAIL_COLLISION", "SIBLING_PAN_COLLISION", "SIBLING_PHONE_COLLISION"]);
  });
  it("ignores the person themselves among the siblings and missing keys", () => {
    expect(fraudFlags(input({ siblings: [p({ clientId: "N", phoneKey: "9800000002" }), p({ clientId: "S" })] }))).toEqual([]);
  });
  it("flags a cap that trimmed the reward", () => expect(fraudFlags(input({ capped: true }))).toEqual(["CAP_APPLIED"]));
});

describe("device signals (hashes only; never block, only flag)", () => {
  const dev = (over: Partial<NonNullable<FraudInput["devices"]>> = {}) => ({ referred: ["dev-N"], referrer: ["dev-R"], siblings: ["dev-S"], otherReferrerReferrals: 0, ...over });
  it("a referral on a different device is clean", () => expect(fraudFlags(input({ devices: dev() }))).toEqual([]));
  it("flags the referred person using the referrer's own device", () => {
    expect(fraudFlags(input({ devices: dev({ referred: ["dev-R"] }) }))).toEqual(["SHARES_DEVICE_WITH_REFERRER"]);
    expect(fraudFlags(input({ devices: dev({ referred: ["dev-x", "dev-R"] }) }))).toEqual(["SHARES_DEVICE_WITH_REFERRER"]);
  });
  it("flags two referred people of the same referrer on one device", () => {
    expect(fraudFlags(input({ devices: dev({ referred: ["dev-S"] }) }))).toEqual(["SIBLING_DEVICE_COLLISION"]);
  });
  it("flags a device that also appears under a different referrer", () => {
    expect(fraudFlags(input({ devices: dev({ otherReferrerReferrals: 1 }) }))).toEqual(["DEVICE_SHARED_ACROSS_REFERRERS"]);
    expect(fraudFlags(input({ devices: dev({ otherReferrerReferrals: 0 }) }))).toEqual([]);
  });
  it("no device data at all (the app sent none) can never raise a device flag", () => {
    expect(fraudFlags(input({ devices: { referred: [], referrer: ["dev-R"], siblings: ["dev-S"], otherReferrerReferrals: 0 } }))).toEqual([]);
    expect(fraudFlags(input({ devices: { referred: ["dev-N"], referrer: [], siblings: [], otherReferrerReferrals: 0 } }))).toEqual([]);
    expect(fraudFlags(input())).toEqual([]);
  });
  it("every device flag has a plain-language label, and the other review flags carry over from the referral", () => {
    for (const f of ["SHARES_DEVICE_WITH_REFERRER", "SIBLING_DEVICE_COLLISION", "DEVICE_SHARED_ACROSS_REFERRERS", "PARTNER_CODE_ALSO_PRESENT"]) expect(FLAG_LABEL[f as keyof typeof FLAG_LABEL]).toMatch(/\w{4,}/);
    expect(fraudFlags(input({ referralFlags: ["PARTNER_CODE_ALSO_PRESENT"] }))).toEqual(["PARTNER_CODE_ALSO_PRESENT"]);
    expect(fraudFlags(input({ referralFlags: ["PARTNER_CODE_ALSO_PRESENT", "PARTNER_CODE_ALSO_PRESENT"], capped: true }))).toEqual(["CAP_APPLIED", "PARTNER_CODE_ALSO_PRESENT"]);
  });
});

import { describe, expect, it } from "vitest";

import { fraudFlags, type FraudInput } from "./fraud";

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

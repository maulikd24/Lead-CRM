import { describe, expect, it } from "vitest";

import { resolvePolicy } from "@/lib/consent/policy";
import { CONSENT_TAB_KEYS, grantedPct, summariseConsent } from "./consent-model";

const NOW = new Date("2026-10-09T10:00:00Z");
const counts = [
  { purpose: "MARKETING_COMMS", granted: 12, withdrawn: 3, expired: 1, notRecorded: 20, legacyGranted: 5 },
  { purpose: "SERVICE_COMMS", granted: 0, withdrawn: 0, expired: 0, notRecorded: 41, legacyGranted: 0 },
  { purpose: "DO_NOT_CONTACT", granted: 2, withdrawn: 1, expired: 0, notRecorded: 38, legacyGranted: 0 },
];

describe("consent tabs", () => {
  it("are overview, ledger, withdrawals, policy in that order", () => {
    expect(CONSENT_TAB_KEYS).toEqual(["overview", "ledger", "withdrawals", "policy"]);
  });
});

describe("grantedPct", () => {
  it("counts lead-form grants and rounds", () => {
    expect(grantedPct(counts[0])).toBe(41); // 17 of 41
  });
  it("is 0 when nothing is recorded at all", () => {
    expect(grantedPct({ purpose: "X", granted: 0, withdrawn: 0, expired: 0, notRecorded: 0, legacyGranted: 0 })).toBe(0);
  });
});

describe("summariseConsent", () => {
  const recent = [
    { id: "1", purpose: "MARKETING_COMMS", channel: null, source: "APP", at: new Date("2026-10-09T08:00:00Z"), clientId: "a", clientCode: "A" },
    { id: "2", purpose: "MARKETING_COMMS", channel: null, source: "APP", at: new Date("2026-10-01T08:00:00Z"), clientId: "b", clientCode: "B" },
  ];
  it("counts do-not-contact in force, withdrawals in the last 24 hours and purposes that need an opt-in", () => {
    const s = summariseConsent({ policy: resolvePolicy({}), counts, recent, now: NOW });
    expect(s.dndInForce).toBe(2);
    expect(s.withdrawnLast24h).toBe(1);
    expect(s.optInPurposes).toBe(4);
  });
  it("drops an opt-in purpose switched to record only", () => {
    const s = summariseConsent({ policy: resolvePolicy({ CONSENT_RECORD_ONLY_PURPOSES: "MARKETING_COMMS" }), counts, recent, now: NOW });
    expect(s.optInPurposes).toBe(3);
  });
});

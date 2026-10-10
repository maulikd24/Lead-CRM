import { beforeEach, describe, expect, it } from "vitest";

import { attributeSignup } from "./attribute";
import { FakeStore } from "./fake-store";
import { accrualStates } from "./ledger";
import { refreshProgress } from "./refresh";
import type { RuleSpec } from "./rewards";

const T = (s: string) => new Date(s);
const kycRule: RuleSpec = { id: "rk", event: "KYC_COMPLETE", kind: "FIXED", fixedPaise: 10000, percentBps: null, maxRewardPaise: null, capPerReferrerMonthPaise: null, validFrom: null, validTo: null, active: true };
const fundRule: RuleSpec = { id: "rf", event: "FIRST_FUNDING", kind: "PERCENT", fixedPaise: null, percentBps: 100, maxRewardPaise: null, capPerReferrerMonthPaise: null, validFrom: null, validTo: null, active: true };
let store: FakeStore;

async function refer(n: number, at = "2027-01-10T10:00:00Z") {
  const id = `cN${n}`;
  store.parties.set(id, { clientId: id, phoneKey: `98000001${String(n).padStart(2, "0")}`, emailKey: null, pan: null });
  await attributeSignup({ store, userId: `u-${n}`, referralCode: "ABCD2345", outcome: { status: "created", clientId: id }, signedUpAt: T(at) });
  return store.referrals.find((r) => r.referredClientId === id)!;
}

beforeEach(() => {
  store = new FakeStore();
  const referrer = { clientId: "cR", phoneKey: "9800000001", emailKey: null, pan: null };
  store.parties.set("cR", referrer);
  store.parties.set("referrer-of:ref1", referrer);
  store.codes.set("ABCD2345", { id: "code1", referrerId: "ref1", status: "ACTIVE", createdAt: T("2027-01-01T00:00:00Z"), revokedAt: null, referrerStatus: "ACTIVE", referrer });
});

describe("refreshProgress", () => {
  it("with no rules configured, events are recorded but nothing ever accrues", async () => {
    const r = await refer(1);
    r.evidence = { kycApprovedAt: T("2027-01-12T00:00:00Z"), firstFundedAt: T("2027-01-13T00:00:00Z"), fundedAmountPaise: 5_000_000 };
    const out = await refreshProgress({ store, now: T("2027-01-20T00:00:00Z") });
    expect(store.events.get(r.id)?.map((e) => e.type)).toEqual(["SIGNED_UP", "KYC_COMPLETE", "FIRST_FUNDING"]);
    expect(store.ledger).toHaveLength(0);
    expect(out).toMatchObject({ eventsRecorded: 2, entriesAccrued: 0 });
  });
  it("accrues per active rule on each event, and a second refresh changes nothing", async () => {
    store.rules = [kycRule, fundRule];
    const r = await refer(1);
    r.evidence = { kycApprovedAt: T("2027-01-12T00:00:00Z"), firstFundedAt: T("2027-01-13T00:00:00Z"), fundedAmountPaise: 5_000_000 };
    await refreshProgress({ store, now: T("2027-01-20T00:00:00Z") });
    expect(store.ledger.map((e) => [e.kind, e.amountPaise, e.periodMonth])).toEqual([["ACCRUED", 10000, "2027-01"], ["ACCRUED", 50000, "2027-01"]]);
    const again = await refreshProgress({ store, now: T("2027-01-21T00:00:00Z") });
    expect(store.ledger).toHaveLength(2);
    expect(again).toMatchObject({ eventsRecorded: 0, entriesAccrued: 0 });
  });
  it("does not accrue funding before KYC", async () => {
    store.rules = [fundRule];
    const r = await refer(1);
    r.evidence = { kycApprovedAt: null, firstFundedAt: T("2027-01-13T00:00:00Z"), fundedAmountPaise: 5_000_000 };
    await refreshProgress({ store, now: T("2027-01-20T00:00:00Z") });
    expect(store.ledger).toHaveLength(0);
  });
  it("applies the monthly cap, flags the trimmed reward and puts it in review", async () => {
    store.rules = [{ ...kycRule, capPerReferrerMonthPaise: 15000 }];
    for (const n of [1, 2]) (await refer(n)).evidence = { kycApprovedAt: T("2027-01-12T00:00:00Z"), firstFundedAt: null, fundedAmountPaise: null };
    await refreshProgress({ store, now: T("2027-01-20T00:00:00Z") });
    expect(store.ledger.map((e) => [e.amountPaise, e.flags])).toEqual([[10000, []], [5000, ["CAP_APPLIED"]]]);
    expect(accrualStates(store.ledger).get(store.ledger[1].id)).toBe("NEEDS_REVIEW");
  });
  it("flags velocity: many referrals in a day put the later rewards in review", async () => {
    store.rules = [kycRule];
    for (let n = 1; n <= 7; n++) (await refer(n)).evidence = { kycApprovedAt: T("2027-01-12T00:00:00Z"), firstFundedAt: null, fundedAmountPaise: null };
    await refreshProgress({ store, now: T("2027-01-20T00:00:00Z") });
    const flagged = store.ledger.filter((e) => e.flags.includes("VELOCITY")).length;
    expect(flagged).toBe(2);
  });
  it("flags a referred person who shares a phone with another referral", async () => {
    store.rules = [kycRule];
    const a = await refer(1);
    const b = await refer(2);
    store.parties.get("cN2")!.phoneKey = store.parties.get("cN1")!.phoneKey;
    for (const r of [a, b]) r.evidence = { kycApprovedAt: T("2027-01-12T00:00:00Z"), firstFundedAt: null, fundedAmountPaise: null };
    await refreshProgress({ store, now: T("2027-01-20T00:00:00Z") });
    expect(store.ledger.every((e) => e.flags.includes("SIBLING_PHONE_COLLISION"))).toBe(true);
  });
  it("a rule only applies to events inside its validity window", async () => {
    store.rules = [{ ...kycRule, validFrom: T("2027-02-01T00:00:00Z") }];
    (await refer(1)).evidence = { kycApprovedAt: T("2027-01-12T00:00:00Z"), firstFundedAt: null, fundedAmountPaise: null };
    await refreshProgress({ store, now: T("2027-02-05T00:00:00Z") });
    expect(store.ledger).toHaveLength(0);
  });
  it("the velocity limit can be set in the settings", async () => {
    store.rules = [kycRule];
    store.settings.set("velocity_limit", "1");
    for (const n of [1, 2]) (await refer(n)).evidence = { kycApprovedAt: T("2027-01-12T00:00:00Z"), firstFundedAt: null, fundedAmountPaise: null };
    await refreshProgress({ store, now: T("2027-01-20T00:00:00Z") });
    expect(store.ledger.filter((e) => e.flags.includes("VELOCITY"))).toHaveLength(1);
  });
});

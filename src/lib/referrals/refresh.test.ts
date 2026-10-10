import { beforeEach, describe, expect, it, vi } from "vitest";

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

  it("one referral that fails to save does not stop the others; it is counted and the next run completes it exactly once", async () => {
    store.rules = [kycRule];
    const a = await refer(1);
    const b = await refer(2);
    a.evidence = { kycApprovedAt: T("2027-01-12T00:00:00Z"), firstFundedAt: null, fundedAmountPaise: null };
    b.evidence = { kycApprovedAt: T("2027-01-12T00:00:00Z"), firstFundedAt: null, fundedAmountPaise: null };
    const real = store.commitProgress.bind(store);
    let failing = true;
    vi.spyOn(store, "commitProgress").mockImplementation(async (c) => {
      if (failing && c.referralId === a.id) throw new Error("db blip");
      return real(c);
    });
    const first = await refreshProgress({ store, now: T("2027-01-20T00:00:00Z") });
    expect(first).toMatchObject({ failed: 1, entriesAccrued: 1 });
    expect(store.ledger).toHaveLength(1);
    failing = false;
    const second = await refreshProgress({ store, now: T("2027-01-20T00:05:00Z") });
    expect(second).toMatchObject({ failed: 0, entriesAccrued: 1 });
    expect(store.ledger).toHaveLength(2);
    expect(await refreshProgress({ store, now: T("2027-01-20T00:10:00Z") })).toMatchObject({ failed: 0, entriesAccrued: 0, eventsRecorded: 0 });
    expect(store.ledger).toHaveLength(2);
  });

  it("Needs-review counts only what was actually saved", async () => {
    store.rules = [kycRule];
    const a = await refer(1);
    const b = await refer(2);
    store.parties.set("cN2", { ...store.parties.get("cN2")!, phoneKey: store.parties.get("cN1")!.phoneKey });
    for (const r of [a, b]) r.evidence = { kycApprovedAt: T("2027-01-12T00:00:00Z"), firstFundedAt: null, fundedAmountPaise: null };
    const real = store.commitProgress.bind(store);
    vi.spyOn(store, "commitProgress").mockImplementation(async (c) => {
      if (c.referralId === a.id) throw new Error("blip");
      return real(c);
    });
    const out = await refreshProgress({ store, now: T("2027-01-20T00:00:00Z") });
    expect(out).toMatchObject({ failed: 1, entriesAccrued: 1, needingReview: 1 });
    expect(store.ledger).toHaveLength(1);
  });
});

describe("clawbacks in the refresh", () => {
  const withWindow = (days: number | null): RuleSpec => ({ ...kycRule, clawbackDays: days });
  const approve = (r: { evidence: import("./state-machine").Evidence }, at = "2027-01-12T00:00:00Z") => (r.evidence = { kycApprovedAt: T(at), firstFundedAt: null, fundedAmountPaise: null });

  it("fixes the end of the window on the reward when it accrues, from the event time", async () => {
    store.rules = [withWindow(30)];
    const r = await refer(1);
    approve(r);
    await refreshProgress({ store, now: T("2027-01-20T00:00:00Z") });
    expect(store.ledger[0].clawbackUntil?.toISOString()).toBe("2027-02-11T00:00:00.000Z");
  });
  it("a rule with no window leaves the reward without one", async () => {
    store.rules = [withWindow(null)];
    const r = await refer(1);
    approve(r);
    await refreshProgress({ store, now: T("2027-01-20T00:00:00Z") });
    expect(store.ledger[0].clawbackUntil ?? null).toBeNull();
  });
  it("takes the reward back, once, when KYC is revoked inside the window; the original row is untouched", async () => {
    store.rules = [withWindow(30)];
    const r = await refer(1);
    approve(r);
    await refreshProgress({ store, now: T("2027-01-20T00:00:00Z") });
    const original = { ...store.ledger[0] };
    r.evidence = { kycApprovedAt: null, firstFundedAt: null, fundedAmountPaise: null, kycReversedAt: T("2027-01-25T00:00:00Z") };
    const out = await refreshProgress({ store, now: T("2027-01-26T00:00:00Z") });
    expect(out).toMatchObject({ clawbacks: 1, failed: 0 });
    expect(store.ledger).toHaveLength(2);
    expect(store.ledger[0]).toEqual(original);
    expect(store.ledger[1]).toMatchObject({ kind: "CLAWBACK", amountPaise: -10000, refEntryId: original.id, flags: ["CLAWBACK_KYC_REVOKED"] });
    expect(accrualStates(store.ledger).get(original.id)).toBe("CLAWED_BACK");
    expect(await refreshProgress({ store, now: T("2027-01-27T00:00:00Z") })).toMatchObject({ clawbacks: 0 });
    expect(store.ledger).toHaveLength(2);
  });
  it("a reversal after the window takes nothing back", async () => {
    store.rules = [withWindow(30)];
    const r = await refer(1);
    approve(r);
    await refreshProgress({ store, now: T("2027-01-20T00:00:00Z") });
    r.evidence = { kycApprovedAt: null, firstFundedAt: null, fundedAmountPaise: null, kycReversedAt: T("2027-03-01T00:00:00Z") };
    expect(await refreshProgress({ store, now: T("2027-03-02T00:00:00Z") })).toMatchObject({ clawbacks: 0 });
    expect(store.ledger).toHaveLength(1);
  });
  it("still watches a finished referral while a window is open, even when every rule has since been switched off", async () => {
    store.rules = [withWindow(30), fundRule];
    const r = await refer(1);
    r.evidence = { kycApprovedAt: T("2027-01-12T00:00:00Z"), firstFundedAt: T("2027-01-13T00:00:00Z"), fundedAmountPaise: 5_000_000 };
    await refreshProgress({ store, now: T("2027-01-20T00:00:00Z") });
    store.rules = [];
    r.evidence = { ...r.evidence, kycApprovedAt: null, kycReversedAt: T("2027-01-22T00:00:00Z") };
    expect(await refreshProgress({ store, now: T("2027-01-23T00:00:00Z") })).toMatchObject({ clawbacks: 1 });
  });
  it("funding reversed inside a window takes the funding reward back and leaves the KYC reward", async () => {
    store.rules = [withWindow(30), { ...fundRule, clawbackDays: 60 }];
    const r = await refer(1);
    r.evidence = { kycApprovedAt: T("2027-01-12T00:00:00Z"), firstFundedAt: T("2027-01-13T00:00:00Z"), fundedAmountPaise: 5_000_000 };
    await refreshProgress({ store, now: T("2027-01-20T00:00:00Z") });
    r.evidence = { ...r.evidence, firstFundedAt: null, fundingReversedAt: T("2027-02-20T00:00:00Z") };
    await refreshProgress({ store, now: T("2027-02-21T00:00:00Z") });
    const claws = store.ledger.filter((e) => e.kind === "CLAWBACK");
    expect(claws).toHaveLength(1);
    expect(claws[0]).toMatchObject({ amountPaise: -50000, flags: ["CLAWBACK_FUNDING_REVERSED"] });
  });
  it("a later edit of the rule does not move a reward's window", async () => {
    store.rules = [withWindow(30)];
    const r = await refer(1);
    approve(r);
    await refreshProgress({ store, now: T("2027-01-20T00:00:00Z") });
    store.rules = [withWindow(5)];
    r.evidence = { kycApprovedAt: null, firstFundedAt: null, fundedAmountPaise: null, kycReversedAt: T("2027-02-05T00:00:00Z") };
    expect(await refreshProgress({ store, now: T("2027-02-06T00:00:00Z") })).toMatchObject({ clawbacks: 1 });
  });
  it("a clawback that cannot be saved is retried on the next run and then recorded once", async () => {
    store.rules = [withWindow(30)];
    const r = await refer(1);
    approve(r);
    await refreshProgress({ store, now: T("2027-01-20T00:00:00Z") });
    r.evidence = { kycApprovedAt: null, firstFundedAt: null, fundedAmountPaise: null, kycReversedAt: T("2027-01-25T00:00:00Z") };
    const real = store.commitProgress.bind(store);
    const spy = vi.spyOn(store, "commitProgress").mockRejectedValueOnce(new Error("blip"));
    expect(await refreshProgress({ store, now: T("2027-01-26T00:00:00Z") })).toMatchObject({ failed: 1, clawbacks: 0 });
    spy.mockImplementation(real);
    expect(await refreshProgress({ store, now: T("2027-01-26T00:05:00Z") })).toMatchObject({ failed: 0, clawbacks: 1 });
    expect(store.ledger.filter((e) => e.kind === "CLAWBACK")).toHaveLength(1);
  });
});

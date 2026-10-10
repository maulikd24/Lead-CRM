import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());
vi.mock("@/lib/db/prisma", () => ({ prisma: { referrer: { findUnique: async () => mem.referrerRow } } }));
vi.mock("@/lib/consent/enforce", () => ({ checkConsent: vi.fn(async () => ({ allowed: true, reason: "ENFORCEMENT_OFF", state: "UNKNOWN" })) }));

const mem = vi.hoisted(() => ({ store: null as unknown, admin: null as unknown, referrerRow: null as unknown }));
vi.mock("@/lib/referrals/prisma-store", async () => {
  const { FakeStore } = await import("@/lib/referrals/fake-store");
  mem.store = new FakeStore();
  return { prismaReferralStore: mem.store };
});
vi.mock("@/lib/referrals/prisma-admin", async () => {
  const { FakeAdmin } = await import("@/lib/referrals/fake-admin");
  mem.admin = new FakeAdmin();
  return { prismaAdminStore: mem.admin };
});

import type { FakeAdmin } from "@/lib/referrals/fake-admin";
import type { FakeStore } from "@/lib/referrals/fake-store";
import * as actions from "./actions";

const store = () => mem.store as FakeStore;
const admin = () => mem.admin as FakeAdmin;

const ALL_CALLS: [string, () => Promise<unknown>][] = [
  ["enrollReferrerAction", () => actions.enrollReferrerAction("CL-00001")],
  ["issueCodeAction", () => actions.issueCodeAction("r")],
  ["revokeCodeAction", () => actions.revokeCodeAction("c", "because")],
  ["setReferrerStatusAction", () => actions.setReferrerStatusAction("r", "SUSPENDED")],
  ["saveRuleAction", () => actions.saveRuleAction({})],
  ["setRuleActiveAction", () => actions.setRuleActiveAction("x", true)],
  ["saveSettingAction", () => actions.saveSettingAction("disclaimer", "x")],
  ["recordSignoffAction", () => actions.recordSignoffAction("A. Reviewer")],
  ["refreshAction", () => actions.refreshAction()],
  ["prepareStatementAction", () => actions.prepareStatementAction("R", "2027-01")],
  ["approveStatementAction", () => actions.approveStatementAction("s")],
  ["markPaidAction", () => actions.markPaidAction("s", "UTR123456")],
  ["reverseEntryAction", () => actions.reverseEntryAction("R", "e", "because")],
  ["clearReviewAction", () => actions.clearReviewAction("R", "e", "checked it")],
  ["draftInviteAction", () => actions.draftInviteAction("r")],
];

beforeEach(() => {
  resetSession();
  vi.stubEnv("REFERRAL_PROGRAM_ENABLED", "1");
  store().statements.length = 0;
  store().ledger.length = 0;
  admin().rules.length = 0;
  admin().referrers.length = 0;
  admin().codes.length = 0;
  admin().settings.clear();
  admin().clients.set("CL-00001", { id: "c1", name: "Asha Test", status: "ACTIVE", mergedIntoId: null, isDeleted: false });
});

describe.each(ALL_CALLS)("%s", (_name, call) => {
  it("sends an anonymous visitor to login", async () => {
    asAnonymous();
    expect(await outcomeOf(call)).toMatchObject({ kind: "redirect", url: "/login" });
  });
  it.each(["MANAGER", "RM", "DEALER", "PARTNER", "AFFILIATE", "TEAM_MANAGER"] as const)("redirects a %s away", async (role) => {
    asUser({ role });
    expect((await outcomeOf(call)).kind).toBe("redirect");
  });
  it("is refused while the flag is off", async () => {
    vi.stubEnv("REFERRAL_PROGRAM_ENABLED", "");
    asUser({ role: "ADMIN" });
    expect(await outcomeOf(call)).toMatchObject({ kind: "returned", value: { ok: false } });
  });
});

describe("what Finance may and may not do", () => {
  it("cannot enrol referrers, manage codes, edit rules or settings, record a sign-off, or draft invitations", async () => {
    asUser({ role: "FINANCE" });
    for (const call of [() => actions.enrollReferrerAction("CL-00001"), () => actions.saveRuleAction({ name: "x" }), () => actions.setRuleActiveAction("x", true), () => actions.saveSettingAction("disclaimer", "x"), () => actions.recordSignoffAction("A. Reviewer"), () => actions.draftInviteAction("r"), () => actions.issueCodeAction("r"), () => actions.revokeCodeAction("c", "because"), () => actions.setReferrerStatusAction("r", "SUSPENDED")]) {
      expect(await outcomeOf(call)).toMatchObject({ kind: "returned", value: { ok: false, error: expect.stringMatching(/permission/i) } });
    }
    expect(admin().referrers).toHaveLength(0);
    expect(admin().rules).toHaveLength(0);
  });
  it("Admin can enrol and configure", async () => {
    asUser({ role: "ADMIN" });
    expect(await outcomeOf(() => actions.enrollReferrerAction("CL-00001"))).toMatchObject({ value: { ok: true } });
    expect(await outcomeOf(() => actions.saveSettingAction("disclaimer", "Terms apply."))).toMatchObject({ value: { ok: true } });
  });
});

describe("four-eyes through the server actions", () => {
  async function seedAccrual() {
    await store().appendEntries([{ idempotencyKey: "a", kind: "ACCRUED", referrerId: "R", referralId: null, eventType: "KYC_COMPLETE", ruleId: "r", refEntryId: null, statementId: null, amountPaise: 10000, periodMonth: "2027-01", flags: [], note: null, actorId: null }]);
  }
  it("the preparer cannot approve; a different Admin or Finance user can; then Finance marks it paid with a reference", async () => {
    await seedAccrual();
    asUser({ id: "u-1", role: "ADMIN" });
    const prep = (await actions.prepareStatementAction("R", "2027-01")) as { ok: true; statementId: string };
    expect(prep.ok).toBe(true);
    expect(await actions.approveStatementAction(prep.statementId)).toMatchObject({ ok: false, error: expect.stringMatching(/second pair of eyes/i) });
    asUser({ id: "u-2", role: "FINANCE" });
    expect(await actions.approveStatementAction(prep.statementId)).toEqual({ ok: true });
    expect(await actions.markPaidAction(prep.statementId, "")).toMatchObject({ ok: false });
    expect(await actions.markPaidAction(prep.statementId, "UTR2027011234567")).toEqual({ ok: true });
    expect(store().statements[0]).toMatchObject({ status: "PAID", bankReference: "UTR2027011234567" });
  });
});

const form = { name: "KYC bonus", event: "KYC_COMPLETE", kind: "FIXED", amountRupees: "100", maxRewardRupees: "", capPerMonthRupees: "", validFrom: "", validTo: "" };

describe("each Admin action does its job, and takes untrusted input safely", () => {
  it("enrols, issues, revokes and suspends through the right services", async () => {
    asUser({ role: "ADMIN" });
    const enrolled = (await actions.enrollReferrerAction("  cl-00001 ")) as { ok: true; referrerId: string };
    expect(enrolled.ok).toBe(true);
    expect(await actions.issueCodeAction(enrolled.referrerId)).toEqual({ ok: true });
    expect(admin().codes).toHaveLength(2);
    expect(await actions.revokeCodeAction(admin().codes[0].id, "Shared by mistake")).toEqual({ ok: true });
    expect(admin().codes[0].status).toBe("REVOKED");
    expect(await actions.setReferrerStatusAction(enrolled.referrerId, "SUSPENDED")).toEqual({ ok: true });
    expect(admin().referrers[0].status).toBe("SUSPENDED");
    expect(await actions.setReferrerStatusAction(enrolled.referrerId, "ACTIVE")).toEqual({ ok: true });
    expect(admin().referrers[0].status).toBe("ACTIVE");
  });
  it("a status that is neither ACTIVE nor SUSPENDED changes nothing", async () => {
    asUser({ role: "ADMIN" });
    const enrolled = (await actions.enrollReferrerAction("CL-00001")) as { ok: true; referrerId: string };
    for (const bad of ["suspended", "DELETE", 1, null, undefined, {}]) expect((await actions.setReferrerStatusAction(enrolled.referrerId, bad)).ok).toBe(false);
    expect(admin().referrers[0].status).toBe("ACTIVE");
  });
  it("non-string input never reaches a service as anything but an empty string", async () => {
    asUser({ role: "ADMIN" });
    for (const bad of [null, undefined, 42, {}, [], true]) {
      expect((await actions.enrollReferrerAction(bad)).ok).toBe(false);
      expect((await actions.issueCodeAction(bad)).ok).toBe(false);
      expect((await actions.revokeCodeAction(bad, bad)).ok).toBe(false);
    }
    expect(admin().referrers).toHaveLength(0);
  });
  it("saves a rule off, edits it, and only switches it on when the wording is signed off", async () => {
    asUser({ role: "ADMIN" });
    const saved = (await actions.saveRuleAction(form)) as { ok: true; ruleId: string };
    expect(saved.ok).toBe(true);
    expect(admin().rules[0]).toMatchObject({ active: false, fixedPaise: 10000 });
    expect((await actions.saveRuleAction({ ...form, amountRupees: "200" }, saved.ruleId)).ok).toBe(true);
    expect(admin().rules).toHaveLength(1);
    expect(admin().rules[0].fixedPaise).toBe(20000);
    expect(await actions.setRuleActiveAction(saved.ruleId, true)).toMatchObject({ ok: false, error: expect.stringMatching(/sign-off/i) });
    asUser({ id: "u-compliance-admin", role: "ADMIN" });
    expect((await actions.recordSignoffAction("A. Reviewer")).ok).toBe(true);
    expect(await actions.setRuleActiveAction(saved.ruleId, true)).toEqual({ ok: true });
    expect(admin().rules[0].active).toBe(true);
    expect(await actions.setRuleActiveAction(saved.ruleId, "yes")).toEqual({ ok: true });
    expect(admin().rules[0].active).toBe(false);
  });
  it("a rule form field that is not text is treated as empty, never as a number or object", async () => {
    asUser({ role: "ADMIN" });
    expect((await actions.saveRuleAction({ ...form, amountRupees: 100 as never })).ok).toBe(false);
    expect((await actions.saveRuleAction({ ...form, name: { toString: () => "x" } as never })).ok).toBe(false);
    expect(admin().rules).toHaveLength(0);
  });
  it("only the two known settings can be saved, and the value is bounded", async () => {
    asUser({ role: "ADMIN" });
    expect(await actions.saveSettingAction("disclaimer ", "x")).toMatchObject({ ok: false });
    expect(await actions.saveSettingAction("__proto__", "x")).toMatchObject({ ok: false });
    expect(await actions.saveSettingAction("velocity_limit", "12")).toEqual({ ok: true });
    expect(admin().settings.get("velocity_limit")).toBe("12");
    expect((await actions.saveSettingAction("disclaimer", "y".repeat(5000))).ok).toBe(false);
  });
  it("the editor of the wording cannot record its sign-off through the action either", async () => {
    asUser({ id: "u-editor", role: "ADMIN" });
    expect((await actions.saveSettingAction("disclaimer", "Our wording.")).ok).toBe(true);
    expect(await actions.recordSignoffAction("A. Reviewer")).toMatchObject({ ok: false });
    expect(admin().settings.has("disclaimer_signoff")).toBe(false);
  });
});

describe("statement actions are open to Finance, and reversal and review work through them", () => {
  const accrual = (key: string, flags: string[] = []) => ({ idempotencyKey: key, kind: "ACCRUED" as const, referrerId: "R", referralId: null, eventType: "KYC_COMPLETE" as const, ruleId: "r", refEntryId: null, statementId: null, amountPaise: 10000, periodMonth: "2027-01", flags, note: null, actorId: null });
  it("Finance can reverse an accrual with a reason and clear a flagged one with a note; blank reasons are refused", async () => {
    await store().appendEntries([accrual("a1"), accrual("a2", ["VELOCITY"])]);
    asUser({ id: "fin", role: "FINANCE" });
    const [a1, a2] = store().ledger.slice(-2);
    expect((await actions.reverseEntryAction("R", a1.id, " ")).ok).toBe(false);
    expect(await actions.reverseEntryAction("R", a1.id, "Duplicate customer")).toEqual({ ok: true });
    expect((await actions.clearReviewAction("R", a2.id, "x")).ok).toBe(false);
    expect(await actions.clearReviewAction("R", a2.id, "Checked the two phones, different people")).toEqual({ ok: true });
    expect(store().ledger.filter((e) => e.kind === "REVERSED")).toHaveLength(1);
    expect(store().ledger.filter((e) => e.kind === "REVIEW_CLEARED")).toHaveLength(1);
  });
  it("a reward of another referrer cannot be reversed by naming the wrong referrer", async () => {
    await store().appendEntries([accrual("b1")]);
    asUser({ id: "fin", role: "FINANCE" });
    const e = store().ledger.at(-1)!;
    expect(await actions.reverseEntryAction("SOMEONE-ELSE", e.id, "Not theirs")).toMatchObject({ ok: false });
    expect(store().ledger.filter((x) => x.kind === "REVERSED")).toHaveLength(0);
  });
});

describe("refresh and the invitation draft", () => {
  it("refresh reports what the job did, for Admin and Finance", async () => {
    for (const role of ["ADMIN", "FINANCE"] as const) {
      asUser({ role });
      const r = await actions.refreshAction();
      expect(r).toMatchObject({ ok: true, message: expect.stringMatching(/Checked \d+ referrals/) });
    }
  });
  it("the draft is text only, needs a sign-off, and names the referrer by first name", async () => {
    vi.stubEnv("REFERRAL_LINK_BASE", "https://example.test/join");
    mem.referrerRow = { status: "ACTIVE", client: { id: "c1", name: "  Asha  Test " }, codes: [{ code: "ABCD2345" }] };
    asUser({ role: "ADMIN" });
    expect(await actions.draftInviteAction("r1")).toMatchObject({ ok: false, error: expect.stringMatching(/sign-off/i) });
    asUser({ id: "u-reviewer", role: "ADMIN" });
    await actions.recordSignoffAction("A. Reviewer");
    const r = (await actions.draftInviteAction("r1")) as { ok: true; text: string; code: string; consentEnforced: boolean };
    expect(r.ok).toBe(true);
    expect(r.text).toContain("it is Asha.");
    expect(r.text).toContain("https://example.test/join?ref=ABCD2345");
    expect(r.code).toBe("ABCD-2345");
    expect(r.consentEnforced).toBe(false);
    mem.referrerRow = null;
    expect(await actions.draftInviteAction("r1")).toMatchObject({ ok: false });
  });
});

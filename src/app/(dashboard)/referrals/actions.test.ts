import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/consent/enforce", () => ({ checkConsent: vi.fn(async () => ({ allowed: true, reason: "ENFORCEMENT_OFF", state: "UNKNOWN" })) }));

const mem = vi.hoisted(() => ({ store: null as unknown, admin: null as unknown }));
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
  it("cannot enrol referrers, edit rules or settings, or draft invitations", async () => {
    asUser({ role: "FINANCE" });
    for (const call of [() => actions.enrollReferrerAction("CL-00001"), () => actions.saveRuleAction({ name: "x" }), () => actions.setRuleActiveAction("x", true), () => actions.saveSettingAction("disclaimer", "x"), () => actions.draftInviteAction("r")]) {
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

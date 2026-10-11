import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/ai/gateway", () => ({ callModel: async () => ({ kind: "blocked", reason: "kill_switch", runId: null, correlationId: "c" }) }));
vi.mock("@/lib/policy/approvals/canonical/wiring", () => ({
  approvalService: () => ({
    decide: async (...a: unknown[]) => { calls.store.push("canonical.decide"); calls.canon.args.push(a); return calls.canon.decide; },
    get: async () => { calls.store.push("canonical.get"); return { state: calls.canon.state }; },
  }),
}));
vi.mock("@/lib/autopilot/decisions-wiring", () => ({ decisionDeps: () => ({}) }));
vi.mock("@/lib/autopilot/decisions", () => ({ applyApproved: async () => { calls.store.push("applyApproved"); return { ok: true }; } }));
vi.mock("@/lib/autopilot/digest-db", () => ({ decideDigestNow: async () => { calls.store.push("decideDigest"); return { ok: true }; } }));
vi.mock("@/lib/autopilot/audit-db", () => ({ ensureFreshAudit: async () => { calls.store.push("ensureFreshAudit"); } }));

const calls = vi.hoisted(() => ({ store: [] as string[], loads: [] as string[], canon: { state: "approved", decide: { ok: true, state: "approved" } as Record<string, unknown>, args: [] as unknown[][] } }));
vi.mock("@/lib/autopilot/store", async () => {
  const { demoSnapshot } = await import("@/lib/autopilot/fixture.testkit");
  const note = (n: string) => async () => { calls.store.push(n); return null; };
  return {
    loadSnapshot: async (o: { caller: { kind: string; role?: string } }) => { calls.store.push("loadSnapshot"); calls.loads.push(`${o.caller.kind}:${o.caller.role}`); return demoSnapshot(); },
    getRecommendation: note("getRecommendation"), recordDecision: note("recordDecision"), markApplied: note("markApplied"),
    saveDraft: note("saveDraft"), getDraft: note("getDraft"), updateDraft: note("updateDraft"),
    saveRule: note("saveRule"), setRuleEnabled: note("setRuleEnabled"), savePlan: note("savePlan"), saveTargets: note("saveTargets"), saveSecondApprover: note("saveSecondApprover"),
  };
});

import { canAccessMarketing } from "@/lib/access/marketing-access";
import { activateDraftAction, applyRecommendationAction, askAutopilotAction, decideAction, decideDigestAction, draftRuleAction, previewRuleAction, refreshAuditAction, saveSecondApproverAction, discardDraftAction, launchPausedAction, previewLaunchAction, recordAnnexureAction, saveLaunchDraftAction, savePlanAction, saveRuleAction, saveTargetsAction, toggleRuleAction } from "./actions";

const ALL_ACTIONS: [string, () => Promise<unknown>][] = [
  ["decide", () => decideAction("x", "approve")],
  ["apply", () => applyRecommendationAction("x")],
  ["ask", () => askAutopilotAction("how much are we wasting")],
  ["preview", () => previewLaunchAction({ name: "n" })],
  ["saveDraft", () => saveLaunchDraftAction({ name: "n" })],
  ["launch", () => launchPausedAction("x")],
  ["annexure", () => recordAnnexureAction("x")],
  ["activate", () => activateDraftAction("x")],
  ["discard", () => discardDraftAction("x")],
  ["saveRule", () => saveRuleAction({ name: "r", metric: "spend", op: ">", threshold: 1, days: 7, action: "review_manually" })],
  ["toggleRule", () => toggleRuleAction("x", true)],
  ["plan", () => savePlanAction("c1", 100)],
  ["targets", () => saveTargetsAction({ targetCostPerFunded: 100 })],
  ["draftRule", () => draftRuleAction("pause bad campaigns when cost per funded is over 4000 for a week")],
  ["previewRule", () => previewRuleAction({ name: "r", metric: "spend", op: ">", threshold: 1, days: 7, action: "review_manually" })],
  ["secondApprover", () => saveSecondApproverAction(true)],
  ["digest", () => decideDigestAction("x", "approve")],
  ["refresh", () => refreshAuditAction()],
];

beforeEach(() => { resetSession(); calls.store.length = 0; calls.loads.length = 0; calls.canon.state = "approved"; calls.canon.decide = { ok: true, state: "approved" }; calls.canon.args.length = 0; vi.stubEnv("NEXT_PUBLIC_AUTOPILOT", "1"); vi.stubEnv("AUTOPILOT_ASK_ENABLED", "1"); });

describe("marketing access rule", () => {
  it("admits ADMIN and MARKETING only", () => {
    expect(["ADMIN", "MARKETING"].every(canAccessMarketing)).toBe(true);
    for (const r of ["RM", "MANAGER", "FINANCE", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "", "admin"]) expect(canAccessMarketing(r), r).toBe(false);
  });
});

describe("every Autopilot action is closed to everyone but ADMIN and MARKETING", () => {
  for (const role of ["RM", "MANAGER", "FINANCE"] as const) {
    it(`${role} is turned away from every action and nothing is read or written`, async () => {
      asUser({ role });
      for (const [name, run] of ALL_ACTIONS) {
        const r = await outcomeOf(run);
        expect(r.kind, `${role} ${name}`).toBe("redirect");
      }
      expect(calls.store).toEqual([]);
    });
  }
  it("a signed-out caller is sent to login", async () => {
    asAnonymous();
    for (const [name, run] of ALL_ACTIONS) expect(await outcomeOf(run), name).toEqual({ kind: "redirect", url: "/login" });
    expect(calls.store).toEqual([]);
  });
  it("a user who must change their password gets nowhere", async () => {
    asUser({ role: "ADMIN", mustChangePassword: true });
    expect((await outcomeOf(() => decideAction("x", "approve"))).kind).toBe("redirect");
  });
  for (const role of ["ADMIN", "MARKETING"] as const) {
    it(`${role} gets through the gate`, async () => {
      asUser({ role: role as never });
      const r = await outcomeOf(() => saveTargetsAction({ targetCostPerFunded: 100 }));
      expect(r).toMatchObject({ kind: "returned", value: { ok: true } });
      expect(calls.store).toContain("saveTargets");
    });
  }
});

describe("the outcome provider is asked as the signed-in person", () => {
  it("the snapshot is loaded for the caller's own role, so the provider decides what to blur (exact for ADMIN, coarse for MARKETING)", async () => {
    asUser({ role: "MARKETING" as never });
    await previewLaunchAction({ name: "n", totalBudget: 1000, days: 10, geo: { kind: "cities", values: "Pune" }, landingUrl: "https://x.test" });
    asUser({ role: "ADMIN" });
    await previewLaunchAction({ name: "n", totalBudget: 1000, days: 10, geo: { kind: "cities", values: "Pune" }, landingUrl: "https://x.test" });
    expect(calls.loads).toEqual(["user:MARKETING", "user:ADMIN"]);
  });
});

describe("the flag still applies", () => {
  it("with Autopilot off, even an Admin gets 'switched off'", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTOPILOT", "");
    asUser({ role: "ADMIN" });
    expect(await outcomeOf(() => decideAction("x", "approve"))).toMatchObject({ value: { ok: false, error: expect.stringMatching(/switched off/) } });
    expect(calls.store).toEqual([]);
  });
});

describe("approve and deny go through the canonical approval service", () => {
  it("approve calls the canonical service as the signed-in person, for kind autopilot-action, and never the store's own recordDecision", async () => {
    asUser({ role: "MARKETING" as never, id: "mk1" });
    expect(await outcomeOf(() => decideAction("BD1:m1", "approve"))).toMatchObject({ value: { ok: true } });
    expect(calls.store).toContain("canonical.decide");
    expect(calls.store).not.toContain("recordDecision");
    const [actor, ref, decision] = calls.canon.args[0] as [{ id: string; role: string }, string, string];
    expect(actor).toMatchObject({ id: "mk1", role: "MARKETING" });
    expect(ref).toBe("autopilot-action:BD1:m1");
    expect(decision).toBe("approve");
  });
  it("deny needs a reason code, and is sent as a rejection with the reason", async () => {
    asUser({ role: "ADMIN" });
    expect(await outcomeOf(() => decideAction("BD1:m1", "deny", {}))).toMatchObject({ value: { ok: false, error: expect.stringMatching(/reason/i) } });
    expect(calls.store).not.toContain("canonical.decide");
    expect(await outcomeOf(() => decideAction("BD1:m1", "deny", { reasonCode: "already_handled", note: "Paused on Friday" }))).toMatchObject({ value: { ok: true } });
    const [, , decision, input] = calls.canon.args[0] as [unknown, string, string, { reason: string; params: { reasonCode: string } }];
    expect(decision).toBe("reject");
    expect(input).toMatchObject({ reason: "Paused on Friday", params: { reasonCode: "already_handled" } });
  });
  it("a refusal from the service (four eyes, expiry, already decided) is shown, and nothing else runs", async () => {
    asUser({ role: "MARKETING" as never });
    calls.canon.decide = { ok: false, code: "SELF_APPROVAL", error: "A second person must approve this." };
    expect(await outcomeOf(() => decideAction("BD1:m1", "approve"))).toMatchObject({ value: { ok: false, error: "A second person must approve this." } });
  });
  it("applying needs the canonical state to be approved first", async () => {
    asUser({ role: "ADMIN" });
    calls.canon.state = "requested";
    expect(await outcomeOf(() => applyRecommendationAction("BD1:m1"))).toMatchObject({ value: { ok: false, error: expect.stringMatching(/approve/i) } });
    expect(calls.store).not.toContain("applyApproved");
    calls.canon.state = "approved";
    expect(await outcomeOf(() => applyRecommendationAction("BD1:m1"))).toMatchObject({ value: { ok: true } });
    expect(calls.store).toContain("applyApproved");
  });
});

describe("rule drafting and Ask are behind their flag and the gateway", () => {
  it("drafting is refused when the AI flag is off, before any data is read", async () => {
    vi.stubEnv("AUTOPILOT_ASK_ENABLED", "");
    asUser({ role: "MARKETING" as never });
    expect(await outcomeOf(() => draftRuleAction("pause the bad campaigns when cost per funded is high"))).toMatchObject({ value: { ok: false, error: expect.stringMatching(/switched off/) } });
    expect(calls.store).toEqual([]);
  });
  it("with the gateway blocking the model, drafting says it is unavailable and Ask still answers from the keyword router", async () => {
    asUser({ role: "MARKETING" as never });
    expect(await outcomeOf(() => draftRuleAction("pause the bad campaigns when cost per funded is high"))).toMatchObject({ value: { ok: false, error: expect.stringMatching(/not available/i) } });
    const r = await outcomeOf(() => askAutopilotAction("how much are we wasting?"));
    expect(r).toMatchObject({ value: { ok: true, answer: { toolsUsed: ["wasted_spend"] } } });
  });
});

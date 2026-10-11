import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/ai/provider", () => ({ getProvider: vi.fn() }));

const calls = vi.hoisted(() => ({ store: [] as string[], loads: [] as string[] }));
vi.mock("@/lib/autopilot/store", async () => {
  const { demoSnapshot } = await import("@/lib/autopilot/fixture.testkit");
  const note = (n: string) => async () => { calls.store.push(n); return null; };
  return {
    loadSnapshot: async (o: { caller: { kind: string; role?: string } }) => { calls.store.push("loadSnapshot"); calls.loads.push(`${o.caller.kind}:${o.caller.role}`); return demoSnapshot(); },
    getRecommendation: note("getRecommendation"), recordDecision: note("recordDecision"), markApplied: note("markApplied"),
    saveDraft: note("saveDraft"), getDraft: note("getDraft"), updateDraft: note("updateDraft"),
    saveRule: note("saveRule"), setRuleEnabled: note("setRuleEnabled"), savePlan: note("savePlan"), saveTargets: note("saveTargets"),
  };
});

import { canAccessMarketing } from "@/lib/access/marketing-access";
import { activateDraftAction, applyRecommendationAction, askAutopilotAction, decideAction, discardDraftAction, launchPausedAction, previewLaunchAction, recordAnnexureAction, saveLaunchDraftAction, savePlanAction, saveRuleAction, saveTargetsAction, toggleRuleAction } from "./actions";

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
];

beforeEach(() => { resetSession(); calls.store.length = 0; calls.loads.length = 0; vi.stubEnv("NEXT_PUBLIC_AUTOPILOT", "1"); vi.stubEnv("AUTOPILOT_ASK_ENABLED", "1"); });

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

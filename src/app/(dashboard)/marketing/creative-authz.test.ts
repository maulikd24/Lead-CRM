import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());

const { calls, touch } = vi.hoisted(() => {
  const calls = { n: 0 };
  return { calls, touch: () => { calls.n++; return Promise.resolve({ ok: true }); } };
});

vi.mock("@/lib/db/prisma", () => ({ prisma: { agentSetting: { upsert: async () => { calls.n++; }, findUnique: async () => null } } }));
vi.mock("@/lib/ai/provider", () => ({ getProvider: vi.fn() }));
vi.mock("@/lib/creative/store", () => ({
  creativeService: () => ({ createFromKit: async () => { calls.n++; return { ok: true, briefId: "b1" }; }, editVariant: touch, transition: touch, discardBrief: touch, attachReference: touch }),
  loadBrandProfile: async () => (await import("@/lib/creative/brand")).DEFAULT_BRAND_PROFILE && { version: 0, profile: (await import("@/lib/creative/brand")).DEFAULT_BRAND_PROFILE },
  saveBrandProfile: async () => { calls.n++; return { ok: true, version: 1 }; },
}));
vi.mock("@/lib/creative/competitor-db", () => ({ importAd: async () => { calls.n++; return "added"; }, importCsv: async () => { calls.n++; return { added: 0, duplicates: 0, errors: [] }; }, removeAd: touch, removeCompetitor: touch, addCompetitor: touch, setAdTags: touch }));
vi.mock("@/lib/creative/experiments-db", () => ({ deleteExperiment: touch, saveExperiment: touch, normaliseExperiment: (x: unknown) => x }));
vi.mock("@/lib/creative/tags-db", () => ({ clearTag: touch, confirmDraftTags: async () => { calls.n++; return 0; }, ruleTagsFor: () => ({}), saveSuggestedTags: async () => 0, setTag: touch }));
vi.mock("@/lib/creative/settings", () => ({ saveFatigueThresholds: touch, saveWinnerSettings: touch, saveDigestSettings: touch }));
vi.mock("@/lib/director/db", () => ({
  approveDigest: async () => { calls.n++; return true; }, discardDigest: async () => { calls.n++; return true; }, revokeShare: async () => { calls.n++; return true; },
  loadDirectorReport: async () => ({}), createShare: async () => { calls.n++; return { id: "s1", token: "t".repeat(43), expiresAt: new Date("2026-10-20T00:00:00Z") }; },
}));

import * as creative from "./creative-actions";
import * as reports from "./report-actions";

const BRIEF = { title: "t", topic: "opening a demat account", audience: "a", language: "en", hookType: "question", formats: ["meta_feed"] };
const today = new Date().toISOString().slice(0, 10);

/** Every action, called with input that would succeed if the caller is allowed. */
const ACTIONS: Record<string, () => Promise<unknown>> = {
  createBrief: () => creative.createBriefAction(BRIEF, "templates", []),
  saveVariant: () => creative.saveVariantAction("v1", { fields: { headline: ["x"] } }),
  transitionVariant: () => creative.transitionVariantAction("v1", "submit"),
  discardBrief: () => creative.discardBriefAction("b1"),
  attachReference: () => creative.attachReferenceAction("b1", "a1"),
  saveBrandProfile: () => creative.saveBrandProfileAction({}),
  saveThresholds: () => creative.saveThresholdsAction("fatigue", {}),
  setTag: () => creative.setTagAction({ channel: "google", adId: "a1", adName: "n", type: "hook", value: "question" }),
  confirmTags: () => creative.confirmTagsAction("google:a1"),
  suggestTags: () => creative.suggestTagsAction([{ channel: "google", adId: "a1", adName: "n", format: "" }]),
  addCompetitor: () => creative.addCompetitorAction({ name: "Rival" }),
  removeCompetitor: () => creative.removeCompetitorAction("c1"),
  addCompetitorAd: () => creative.addCompetitorAdAction({ competitor: "Rival", copy: "hello", format: "image" }),
  importCsv: () => creative.importCompetitorCsvAction("competitor,copy\nA,b"),
  setCompetitorAdTags: () => creative.setCompetitorAdTagsAction("a1", { hook: "question" }),
  removeCompetitorAd: () => creative.removeCompetitorAdAction("a1"),
  saveExperiment: () => creative.saveExperimentAction(null, { name: "x" }),
  deleteExperiment: () => creative.deleteExperimentAction("e1"),
  createShare: () => reports.createShareAction({ from: "2026-09-01", to: today }),
  revokeShare: () => reports.revokeShareAction("s1"),
  approveDigest: () => reports.approveDigestAction("d1"),
  discardDigest: () => reports.discardDigestAction("d1"),
};
/** Only an Admin may do these (recipients and the AI kill switch). */
const ADMIN_ONLY: Record<string, () => Promise<unknown>> = {
  setAiCreative: () => creative.setAiCreativeAction(true),
  saveDigestSettings: () => reports.saveDigestSettingsAction({ enabled: true, recipients: "a@example.com" }),
};

beforeEach(() => {
  resetSession();
  calls.n = 0;
  vi.stubEnv("NEXT_PUBLIC_CREATIVE_INTEL", "1");
  vi.stubEnv("DIRECTOR_REPORTS_ENABLED", "1");
});

describe("who may call the creative and report actions", () => {
  for (const role of ["ADMIN", "MARKETING"] as const) {
    it(`${role} may call every action`, async () => {
      asUser({ role });
      for (const [name, run] of Object.entries(ACTIONS)) {
        const r = await outcomeOf(run);
        expect(r.kind, name).toBe("returned");
        if (r.kind === "returned") expect((r.value as { ok: boolean }).ok, name).toBe(true);
      }
    });
  }

  for (const role of ["RM", "MANAGER", "FINANCE", "DEALER", "TEAM_MANAGER", "PARTNER"] as const) {
    it(`${role} is bounced from every action before anything runs`, async () => {
      asUser({ role });
      for (const [name, run] of Object.entries({ ...ACTIONS, ...ADMIN_ONLY })) {
        const r = await outcomeOf(run);
        expect(r.kind, `${name} as ${role}`).toBe("redirect");
      }
      expect(calls.n).toBe(0);
    });
  }

  it("nobody signed in is sent to the login page", async () => {
    asAnonymous();
    for (const [name, run] of Object.entries({ ...ACTIONS, ...ADMIN_ONLY })) {
      const r = await outcomeOf(run);
      expect(r, name).toEqual({ kind: "redirect", url: "/login" });
    }
    expect(calls.n).toBe(0);
  });

  it("the recipients and the AI switch are for an Admin only: marketing is bounced", async () => {
    asUser({ role: "MARKETING" });
    for (const [name, run] of Object.entries(ADMIN_ONLY)) expect((await outcomeOf(run)).kind, name).toBe("redirect");
    asUser({ role: "ADMIN" });
    for (const [name, run] of Object.entries(ADMIN_ONLY)) expect((await outcomeOf(run)).kind, name).toBe("returned");
  });

  it("with the flags off, even an Admin gets the 'switched off' answer and nothing runs", async () => {
    vi.stubEnv("NEXT_PUBLIC_CREATIVE_INTEL", "0");
    vi.stubEnv("DIRECTOR_REPORTS_ENABLED", "0");
    asUser({ role: "ADMIN" });
    for (const [name, run] of Object.entries({ ...ACTIONS, ...ADMIN_ONLY })) {
      const r = await outcomeOf(run);
      expect(r.kind, name).toBe("returned");
      if (r.kind === "returned") expect(r.value, name).toMatchObject({ ok: false });
    }
    expect(calls.n).toBe(0);
  });

  it("a variant action with an unknown verb is refused, and there is no publish action", async () => {
    asUser({ role: "MARKETING" });
    const r = await outcomeOf(() => creative.transitionVariantAction("v1", "publish"));
    expect(r).toMatchObject({ kind: "returned", value: { ok: false } });
    expect(Object.keys(creative).some((k) => /publish/i.test(k))).toBe(false);
  });

  it("a thumbnail pointer holding embedded image data is refused", async () => {
    asUser({ role: "MARKETING" });
    const r = await outcomeOf(() => creative.addCompetitorAdAction({ competitor: "R", copy: "c", format: "image", thumbnailRef: "data:image/png;base64,AAAA" }));
    expect(r).toMatchObject({ kind: "returned", value: { ok: false } });
  });

  it("a report period longer than 90 days is refused", async () => {
    asUser({ role: "ADMIN" });
    const r = await outcomeOf(() => reports.createShareAction({ from: "2025-01-01", to: today }));
    expect(r).toMatchObject({ kind: "returned", value: { ok: false } });
  });
});

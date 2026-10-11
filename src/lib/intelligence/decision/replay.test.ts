import { describe, expect, it } from "vitest";
import { makeFacts } from "@/test/factories";
import type { NextBestActionV2 } from "../nba";
import { emptyGateContext } from "./gate-context";
import type { DecisionInput } from "./loader";
import { replay, rewindFacts, snapshotDates, type ReplayDeps } from "./replay";
import { NOW } from "./test-helpers";

const nba: NextBestActionV2 = { programme: "PMS / AIF opportunity", action: "Call", topic: "PMS", reason: "PMS acceptance is high.", priority: "Medium", owner: "RM", timing: "This Week", priorityScore: 58, talkingPoints: [], doNotDiscuss: [] };
const grant = [{ purpose: "MARKETING_COMMS", channel: null, status: "GRANTED", capturedAt: new Date("2026-01-01") }];
const input = (over: Partial<DecisionInput> = {}, gate: Partial<DecisionInput["gate"]> = {}): DecisionInput => ({
  gate: { ...emptyGateContext("c1", NOW), consent: { rows: grant, legacyMarketingConsentAt: null }, ...gate },
  adapter: { now: NOW, facts: makeFacts(), nba, stageGate: null, goalSuggestions: [], nextAction: null, proposals: [], crossSell: [], portfolioAsOf: NOW },
  legacy: { source: "intelligence_nba", programme: nba.programme, action: nba.action, topic: nba.topic, owner: nba.owner, priority: nba.priority, doNotDiscuss: [] },
  factsMissing: false,
  ...over,
});

const deps = (by: Record<string, DecisionInput | null>, events: Record<string, { kind: "contact" | "response"; at: Date }[]> = {}): ReplayDeps => ({
  now: NOW,
  loadInput: async (id) => by[id] ?? null,
  laterEvents: async (id) => (events[id] ?? []).map((e, i) => ({ kind: e.kind, ref: `e${i}`, at: e.at })),
});
const asOf = new Date(NOW.getTime() - 20 * 86400000);
const pts = (...ids: string[]) => ids.map((clientId) => ({ clientId, asOf }));

describe("decision replay", () => {
  it("counts results, agreement and skipped customers", async () => {
    const r = await replay(pts("a", "b", "gone"), deps({ a: input(), b: input({}, { complianceConcernOpen: true }), gone: null }));
    expect(r.evaluated).toBe(2);
    expect(r.skipped).toBe(1);
    expect(r.results).toMatchObject({ RECOMMEND: 1, ABSTAIN: 1 });
    expect(r.abstainReasons).toEqual({ human_review_required: 1 });
    expect(r.agreement).toEqual({ agree: 1, disagree: 1, ratePct: 50 });
    expect(r.disagreementKinds).toEqual({ v2_abstains: 1 });
  });

  it("reports suppression by rule and effect", async () => {
    const r = await replay(pts("a"), deps({ a: input({}, { declined: [{ assetClass: "PMS", because: "declined" }] }) }));
    expect(r.suppression.byRule.declined_class).toBe(1);
    expect(r.suppression.byEffect.block).toBeGreaterThanOrEqual(1);
    expect(r.suppression.blockedCandidates).toBeGreaterThanOrEqual(1);
  });

  it("lists a material regression with the customer and date", async () => {
    const i = input();
    i.legacy = { ...i.legacy!, programme: "No Action / Do Not Pitch", action: "No Action", doNotDiscuss: ["PMS: Recently declined PMS"] };
    const r = await replay(pts("a"), deps({ a: i }));
    expect(r.materialRegressions).toHaveLength(1);
    expect(r.materialRegressions[0]).toMatchObject({ clientId: "a", asOf: asOf.toISOString() });
  });

  it("outcomes: counts follow-up contact and responses per result, labelled correlation", async () => {
    const after = (d: number) => new Date(asOf.getTime() + d * 86400000);
    const r = await replay(pts("a", "b"), deps({ a: input(), b: input() }, { a: [{ kind: "contact", at: after(2) }, { kind: "response", at: after(3) }] }));
    expect(r.outcomes.byResult.RECOMMEND).toEqual({ decisions: 2, followedByContact: 1, followedByResponse: 1 });
    expect(r.outcomes.note).toMatch(/correlation is not causation/);
  });

  it("outcomes are skipped when the follow-up window has not passed yet", async () => {
    const recent = [{ clientId: "a", asOf: new Date(NOW.getTime() - 2 * 86400000) }];
    const r = await replay(recent, deps({ a: input() }));
    expect(r.outcomes.byResult.RECOMMEND.decisions).toBe(0);
  });

  it("is deterministic and always prints its limits", async () => {
    const d = deps({ a: input() });
    expect(await replay(pts("a"), d)).toEqual(await replay(pts("a"), d));
    expect((await replay([], d)).limits.length).toBeGreaterThanOrEqual(3);
  });

  it("rewindFacts cuts event history at the date and leaves state alone", () => {
    const f = makeFacts();
    f.insights = [
      { id: "1", kind: "DECLINED", assetClass: "PMS", text: "t", status: "OPEN", dueAt: null, severity: null, occurredAt: new Date("2026-10-08"), sourceType: "CALL" },
      { id: "2", kind: "INTEREST", assetClass: "PMS", text: "t", status: "OPEN", dueAt: null, severity: null, occurredAt: new Date("2026-09-01"), sourceType: "CALL" },
    ];
    f.outcomes = [{ outcome: "NOT_INTERESTED", assetClass: "PMS", createdAt: new Date("2026-10-08") }];
    const r = rewindFacts(f, new Date("2026-09-15"), new Date("2026-09-10"));
    expect(r.insights.map((i) => i.id)).toEqual(["2"]);
    expect(r.outcomes).toEqual([]);
    expect(r.lastActivityAt).toEqual(new Date("2026-09-10"));
    expect(r.stage).toBe(f.stage);
  });

  it("snapshot dates are spaced and none is too recent", () => {
    const d = snapshotDates(NOW, 3, 7, 8);
    expect(d.map((x) => Math.round((NOW.getTime() - x.getTime()) / 86400000))).toEqual([8, 15, 22]);
  });
});

import { describe, expect, it } from "vitest";
import { makeFacts } from "@/test/factories";
import type { NextBestActionV2 } from "../nba";
import { buildDecision, hashDraft } from "./shadow";
import { emptyGateContext } from "./gate-context";
import { NOW } from "./test-helpers";
import type { DecisionInput } from "./loader";

const nba: NextBestActionV2 = { programme: "PMS / AIF opportunity", action: "Call", topic: "PMS", reason: "PMS acceptance is high.", priority: "Medium", owner: "RM", timing: "This Week", priorityScore: 58, talkingPoints: [], doNotDiscuss: [] };
const input = (over: Partial<DecisionInput["gate"]> = {}): DecisionInput => ({
  gate: { ...emptyGateContext("c1", NOW), consent: { rows: [{ purpose: "MARKETING_COMMS", channel: null, status: "GRANTED", capturedAt: new Date("2026-09-01") }], legacyMarketingConsentAt: null }, ...over },
  adapter: { now: NOW, facts: makeFacts(), nba, stageGate: null, goalSuggestions: [], nextAction: null, proposals: [], crossSell: [], portfolioAsOf: NOW },
  legacy: { source: "intelligence_nba", programme: nba.programme, action: nba.action, topic: nba.topic, owner: nba.owner, priority: nba.priority, doNotDiscuss: [] },
  factsMissing: false,
});

describe("shadow computation (pure part)", () => {
  it("agrees with the legacy engine when nothing suppresses", () => {
    const b = buildDecision(input());
    expect(b.draft.result).toBe("RECOMMEND");
    expect(b.disagreement.agrees).toBe(true);
  });
  it("a declined class the legacy engine already blocks never becomes a material regression", () => {
    const i = input({ declined: [{ assetClass: "PMS", because: "Recently declined PMS" }] });
    i.legacy = { ...i.legacy!, programme: "No Action / Do Not Pitch", action: "No Action", doNotDiscuss: ["PMS: Recently declined PMS"] };
    i.adapter.nba = { ...nba, programme: "No Action / Do Not Pitch", action: "No Action", topic: null };
    const b = buildDecision(i);
    expect(b.draft.assetClass).not.toBe("PMS");
    expect(b.disagreement.severity).not.toBe("material");
  });
  it("hash is stable for equal decisions and changes when the advice changes", () => {
    const a = buildDecision(input()).draft;
    expect(hashDraft(a)).toBe(hashDraft(buildDecision(input()).draft));
    expect(hashDraft(a)).not.toBe(hashDraft(buildDecision(input({ complianceConcernOpen: true })).draft));
  });
});

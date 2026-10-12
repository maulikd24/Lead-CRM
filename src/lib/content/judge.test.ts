import { describe, expect, it } from "vitest";

import { checkAdCopy, type RuleResult } from "@/lib/guardrails/ad-copy";

import { JUDGE_PURPOSE, JUDGE_UNAVAILABLE, buildJudgeRequest, combineReview, parseJudgeReply, type JudgeOutcome } from "./judge";

const CLEAR: JudgeOutcome = { kind: "verdict", verdict: "clear", reasons: [] };
const CAUTION: JudgeOutcome = { kind: "verdict", verdict: "caution", reasons: ["Reads like a promise of outcome."] };
const BLOCK: JudgeOutcome = { kind: "verdict", verdict: "block", reasons: ["Implies advice."] };
const ABSTAIN: JudgeOutcome = { kind: "abstain", reason: "reply is not JSON" };

describe("strict parse of the judge reply", () => {
  it("accepts a valid JSON object for each verdict", () => {
    expect(parseJudgeReply('{"verdict":"clear","reasons":[]}')).toEqual({ kind: "verdict", verdict: "clear", reasons: [] });
    expect(parseJudgeReply('{"verdict":"caution","reasons":["Check the wording."]}')).toEqual({ kind: "verdict", verdict: "caution", reasons: ["Check the wording."] });
    expect(parseJudgeReply('  {"verdict":"block","reasons":["Advice."]}\n')).toEqual({ kind: "verdict", verdict: "block", reasons: ["Advice."] });
  });
  it("rejects prose, including prose wrapped around a valid object", () => {
    expect(parseJudgeReply("This copy looks fine.").kind).toBe("abstain");
    expect(parseJudgeReply('Here you go: {"verdict":"clear","reasons":[]}').kind).toBe("abstain");
    expect(parseJudgeReply('```json\n{"verdict":"clear","reasons":[]}\n```').kind).toBe("abstain");
  });
  it("rejects an unknown verdict", () => {
    expect(parseJudgeReply('{"verdict":"approve","reasons":[]}')).toMatchObject({ kind: "abstain", reason: "unknown verdict" });
    expect(parseJudgeReply('{"verdict":"CLEAR","reasons":[]}').kind).toBe("abstain");
  });
  it("rejects an empty reply", () => {
    expect(parseJudgeReply("")).toMatchObject({ kind: "abstain", reason: "empty reply" });
    expect(parseJudgeReply("   \n")).toMatchObject({ kind: "abstain", reason: "empty reply" });
  });
  it("rejects a wrong shape: arrays, extra or missing fields, bad reasons", () => {
    expect(parseJudgeReply('["clear"]').kind).toBe("abstain");
    expect(parseJudgeReply("null").kind).toBe("abstain");
    expect(parseJudgeReply('{"verdict":"clear"}').kind).toBe("abstain");
    expect(parseJudgeReply('{"verdict":"clear","reasons":[],"extra":1}').kind).toBe("abstain");
    expect(parseJudgeReply('{"verdict":"caution","reasons":"no"}').kind).toBe("abstain");
    expect(parseJudgeReply('{"verdict":"caution","reasons":[1]}').kind).toBe("abstain");
    expect(parseJudgeReply('{"verdict":"caution","reasons":["   "]}').kind).toBe("abstain");
    expect(parseJudgeReply(`{"verdict":"caution","reasons":["${"x".repeat(301)}"]}`).kind).toBe("abstain");
    expect(parseJudgeReply(`{"verdict":"caution","reasons":[${Array(11).fill('"r"').join(",")}]}`).kind).toBe("abstain");
  });
});

describe("the judge request is redaction-safe", () => {
  const rules: RuleResult = checkAdCopy({ text: "Guaranteed returns, invest now.", language: "en" });
  it("carries the public copy and the failed rule ids, never the brief or a name", () => {
    const req = buildJudgeRequest("Guaranteed returns, invest now.", "post", rules);
    const user = JSON.parse(req.user) as { channel: string; copy: string; ruleChecksFailed: string[] };
    expect(user.channel).toBe("post");
    expect(user.copy).toContain("Guaranteed returns");
    expect(user.ruleChecksFailed.length).toBeGreaterThan(0);
    expect(req.system).toMatch(/ONLY one JSON object/);
  });
  it("scrubs contact details out of the copy before the judge sees it", () => {
    const req = buildJudgeRequest("Write to a.tester@example.com or call 9876543210 to learn more.", "post", rules);
    expect(req.user).not.toContain("a.tester@example.com");
    expect(req.user).not.toContain("9876543210");
  });
  it("uses the content.judge purpose id", () => {
    expect(JUDGE_PURPOSE).toBe("content.judge");
  });
});

describe("combination table", () => {
  const cases: { name: string; rules: { passed: boolean; reasons: string[] }; judge: JudgeOutcome; readiness: string; reasons: string[] }[] = [
    { name: "rules fail + judge clear = blocked", rules: { passed: false, reasons: ["rule A"] }, judge: CLEAR, readiness: "blocked", reasons: ["rule A"] },
    { name: "rules fail + judge caution = blocked, both reason sets kept", rules: { passed: false, reasons: ["rule A"] }, judge: CAUTION, readiness: "blocked", reasons: ["rule A", "Reads like a promise of outcome."] },
    { name: "rules fail + judge abstain = blocked", rules: { passed: false, reasons: ["rule A"] }, judge: ABSTAIN, readiness: "blocked", reasons: ["rule A", JUDGE_UNAVAILABLE] },
    { name: "rules pass + judge clear = ready for human review", rules: { passed: true, reasons: [] }, judge: CLEAR, readiness: "ready_for_review", reasons: [] },
    { name: "rules pass + judge caution = needs review with reasons", rules: { passed: true, reasons: [] }, judge: CAUTION, readiness: "needs_review", reasons: ["Reads like a promise of outcome."] },
    { name: "rules pass + judge block = needs review with reasons", rules: { passed: true, reasons: [] }, judge: BLOCK, readiness: "needs_review", reasons: ["Implies advice."] },
    { name: "rules pass + judge abstain = needs review, judge unavailable", rules: { passed: true, reasons: [] }, judge: ABSTAIN, readiness: "needs_review", reasons: [JUDGE_UNAVAILABLE] },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(combineReview(c.rules, c.judge)).toEqual({ readiness: c.readiness, reasons: c.reasons });
    });
  }
  it("a caution with no reasons still needs review, with a stated reason", () => {
    const r = combineReview({ passed: true, reasons: [] }, { kind: "verdict", verdict: "caution", reasons: [] });
    expect(r.readiness).toBe("needs_review");
    expect(r.reasons).toEqual(["judge verdict caution with no reason"]);
  });
  it("the judge never turns a rules failure into a pass, for every judge outcome", () => {
    for (const judge of [CLEAR, CAUTION, BLOCK, ABSTAIN]) {
      expect(combineReview({ passed: false, reasons: ["rule A"] }, judge).readiness).toBe("blocked");
    }
  });
  it("nothing is ever approved or published: only three readiness values exist", () => {
    const seen = new Set<string>();
    for (const passed of [true, false]) for (const judge of [CLEAR, CAUTION, BLOCK, ABSTAIN]) seen.add(combineReview({ passed, reasons: [] }, judge).readiness);
    expect([...seen].sort()).toEqual(["blocked", "needs_review", "ready_for_review"]);
  });
});

import type { EvalCase } from "../types";
import { RETURNS_CASES } from "./guardrail-returns";
import { ADVICE_CASES } from "./guardrail-advice";
import { PII_OUT_CASES } from "./guardrail-pii";
import { BENIGN_CASES } from "./guardrail-benign";
import { EVASION_CASES } from "./evasion";
import { HANDOVER_CASES } from "./handover";
import { VENDOR_CASES } from "./vendor";
import { CONSENT_CASES, WINDOW_CASES } from "./consent-window";
import { JUDGE_CASES } from "./judge";
import { NUDGER_CASES, REPLY_CASES } from "./pipelines";

const ALL: EvalCase[] = [
  ...RETURNS_CASES, ...ADVICE_CASES, ...PII_OUT_CASES, ...BENIGN_CASES, ...EVASION_CASES, ...HANDOVER_CASES, ...VENDOR_CASES,
  ...CONSENT_CASES, ...WINDOW_CASES, ...JUDGE_CASES, ...NUDGER_CASES, ...REPLY_CASES,
];

type JudgeCase = Extract<EvalCase, { kind: "judge" }>;

/** Deterministic cases: everything except the live-only judge paraphrases. */
export const ALL_CASES: EvalCase[] = ALL.filter((c) => !(c.kind === "judge" && c.liveOnly));
/**
 * Cases for a real judge, informational only: the liveOnly paraphrases plus every must-block text the regexes are
 * documented to miss, so the second layer can be measured on exactly the cases the first layer cannot see.
 */
export const LIVE_JUDGE_CASES: JudgeCase[] = [
  ...ALL.filter((c): c is JudgeCase => c.kind === "judge" && c.liveOnly === true),
  ...ALL.flatMap((c): JudgeCase[] =>
    c.kind === "guardrail" && c.expect === "block" && c.known
      ? [{ id: `live.${c.id}`, category: "judge_live", lang: c.lang, expect: "block", kind: "judge", text: c.text, scripted: "SAFE", liveOnly: true, note: "regex-known gap, judged live" }]
      : [],
  ),
];

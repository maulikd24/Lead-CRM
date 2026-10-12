import type { AgentBriefing } from "@/lib/intelligence/agent";
import { FakeProvider, type LlmProvider, type LlmRequest } from "@/lib/ai/provider";
import { checkOutbound, needsHandover } from "../guardrails";
import { judgeOutbound } from "../judge";
import { draftNudge, type NudgerDeps } from "../nudger";
import { scrubForVendor, suggestReply, type ConvMessage, type ReplyAssistDeps } from "../reply-assist";
import { checkConsent, type ConsentSnapshot, type EnforceDeps } from "@/lib/consent/enforce";
import { resolvePolicy } from "@/lib/consent/policy";
import { windowBlockReason } from "@/lib/whatsapp/service-window";
import type { CaseResult, Decision, DraftSpec, EvalCase } from "./types";

/** Fixed clock so every case is reproducible. */
export const EVAL_NOW = new Date("2026-10-09T10:00:00Z");
const MIN = 60_000;

const isJudgeCall = (req: LlmRequest) => req.system.includes("compliance reviewer");

/** Deterministic stand-in for the vendor: one scripted reply for the drafting call, one for the judge call. Records the drafting payload. */
class ScriptedProvider implements LlmProvider {
  readonly name = "scripted";
  draftUser: string | null = null;
  constructor(private readonly draft: string | null, private readonly judge: string | null) {}
  async complete(req: LlmRequest) {
    const reply = isJudgeCall(req) ? this.judge : this.draft;
    if (!isJudgeCall(req)) this.draftUser = req.user;
    if (reply === null) throw new Error("scripted provider failure");
    return { text: reply, model: "scripted", inputTokens: 0, outputTokens: 0 };
  }
}

function briefing(name: string, programme: string, opts: { openIssues?: boolean; reason?: string; preferredLanguage?: string }): AgentBriefing {
  return {
    customer: { name, preferredLanguage: opts.preferredLanguage ?? null },
    whyContactingNow: { programme, topic: null, reason: opts.reason ?? "KYC pending" },
    openIssues: opts.openIssues ? [{ text: "open complaint" }] : [],
    mustNotDiscuss: [],
    currentSituations: [],
  } as unknown as AgentBriefing;
}

const toDecision = (blocked: boolean): Decision => (blocked ? "block" : "allow");
const leaked = (haystack: string, needles: string[]) => needles.filter((n) => haystack.toLowerCase().includes(n.toLowerCase()));

async function runNudger(c: Extract<EvalCase, { kind: "nudger" | "vendor_nudger" }>): Promise<{ status: string; provider: ScriptedProvider }> {
  const spec = c.kind === "nudger" ? c : null;
  const draft = spec ? spec : ({ draft: "Hi, your KYC is pending. Could you upload the remaining documents?" } as DraftSpec);
  const provider = new ScriptedProvider(draft.draft, draft.judge === undefined ? "SAFE" : draft.judge);
  const deps: NudgerDeps = {
    briefing: async () => briefing(c.name ?? "Riya Sharma", spec?.programme ?? "Complete KYC", { openIssues: draft.openIssues, reason: c.kind === "vendor_nudger" ? c.reason : undefined }),
    provider,
    isEnabled: async () => draft.enabled ?? true,
    recentProposals: async () => [],
    save: async () => ({ id: "p1" }),
    now: () => EVAL_NOW,
    ...(draft.consentAllowed === undefined ? {} : { consent: async () => ({ allowed: draft.consentAllowed as boolean }) }),
  };
  const res = await draftNudge("c1", deps);
  return { status: res.status, provider };
}

function convo(inbound: string[]): ConvMessage[] {
  return inbound.map((body, i) => ({ id: `m${i}`, direction: "INBOUND" as const, body, at: new Date(EVAL_NOW.getTime() - (inbound.length - i) * MIN) }));
}

async function runReply(c: Extract<EvalCase, { kind: "reply" | "vendor_reply" }>): Promise<{ status: string; provider: ScriptedProvider }> {
  const spec = c.kind === "reply" ? c : null;
  const draft = spec ? spec : ({ draft: "Thanks for reaching out. Which document would you like help with?" } as DraftSpec);
  const provider = new ScriptedProvider(draft.draft, draft.judge === undefined ? "SAFE" : draft.judge);
  const deps: ReplyAssistDeps = {
    isEnabled: async () => draft.enabled ?? true,
    briefing: async () => briefing(c.kind === "vendor_reply" ? c.name : "Riya Sharma", "Complete KYC", { openIssues: draft.openIssues, preferredLanguage: spec?.preferredLanguage }),
    provider,
    loadMessages: async () => convo(c.inbound),
    openProposals: async () => [],
    supersede: async () => 0,
    save: async () => ({ id: "p1" }),
    recordHandover: async () => ({ proposalId: "h1", created: true }),
    now: () => EVAL_NOW,
    ...(draft.consentAllowed === undefined ? {} : { consent: async () => ({ allowed: draft.consentAllowed as boolean }) }),
  };
  const res = await suggestReply("c1", deps);
  return { status: res.status, provider };
}

function consentDeps(c: Extract<EvalCase, { kind: "consent" }>): EnforceDeps {
  const snap: ConsentSnapshot = {
    records: c.records.map((r) => ({ purpose: r.purpose, channel: r.channel, status: r.status, capturedAt: new Date(r.capturedAt), expiresAt: r.expiresAt ? new Date(r.expiresAt) : null })),
    legacyMarketingConsentAt: c.legacyMarketingConsentAt ? new Date(c.legacyMarketingConsentAt) : null,
  };
  return {
    enforced: () => c.enforced,
    load: async () => new Map([["c1", snap]]),
    now: () => EVAL_NOW,
    policy: () => resolvePolicy({ CONSENT_RECORD_ONLY_PURPOSES: c.recordOnly }),
  };
}

/** Real provider, only when the caller injected one (EVALS_REAL_PROVIDER=1 in the CLI). Judges the text and reports the decision. */
export async function evaluateLive(c: Extract<EvalCase, { kind: "judge" }>, provider: LlmProvider): Promise<CaseResult> {
  const v = await judgeOutbound(c.text, provider);
  return { case: c, actual: toDecision(!v.safe), detail: v.safe ? "SAFE" : v.reason };
}

export async function evaluate(c: EvalCase): Promise<CaseResult> {
  try {
    switch (c.kind) {
      case "guardrail": {
        const r = checkOutbound(c.text);
        const codeOk = !c.code || r.ok || r.code === c.code;
        return { case: c, actual: toDecision(!r.ok), detail: r.ok ? "ok" : `${r.code}${codeOk ? "" : ` (wanted ${c.code})`}`, ...(codeOk ? {} : { error: `wrong code: wanted ${c.code}` }) };
      }
      case "handover": {
        const r = needsHandover(c.text);
        return { case: c, actual: toDecision(r.handover), detail: r.reason ?? "no handover" };
      }
      case "scrub": {
        const out = scrubForVendor(c.text);
        // block = redacted (no sensitive token survives); allow = harmless text kept intact.
        const left = leaked(out, c.sensitive ?? []);
        const lost = (c.keep ?? []).filter((k) => !out.includes(k));
        const blocked = c.sensitive?.length ? left.length === 0 : lost.length > 0;
        return { case: c, actual: toDecision(blocked), detail: left.length ? `leaked: ${left.join(", ")}` : lost.length ? `lost: ${lost.join(", ")}` : `-> ${out.slice(0, 80)}` };
      }
      case "consent": {
        const d = await checkConsent("c1", c.purpose as never, c.channel as never, consentDeps(c));
        return { case: c, actual: toDecision(!d.allowed), detail: d.reason };
      }
      case "window": {
        const last = c.lastInboundMinutesAgo === null ? null : new Date(EVAL_NOW.getTime() - c.lastInboundMinutesAgo * MIN);
        const r = windowBlockReason({ enforced: c.enforced, provider: c.provider, lastInboundAt: last, now: EVAL_NOW });
        return { case: c, actual: toDecision(r !== null), detail: r ?? "within window or not enforced" };
      }
      case "judge": {
        const provider = new FakeProvider(c.scripted === null ? new Error("down") : c.scripted);
        const v = await judgeOutbound(c.text, provider);
        return { case: c, actual: toDecision(!v.safe), detail: v.safe ? "SAFE" : v.reason };
      }
      case "nudger": {
        const { status } = await runNudger(c);
        return { case: c, actual: toDecision(status !== "drafted"), detail: status };
      }
      case "reply": {
        const { status } = await runReply(c);
        return { case: c, actual: toDecision(status !== "drafted"), detail: status };
      }
      case "vendor_nudger": {
        const { provider } = await runNudger(c);
        const left = leaked(provider.draftUser ?? "", c.sensitive);
        return { case: c, actual: toDecision(left.length === 0), detail: left.length ? `sent to vendor: ${left.join(", ")}` : "nothing sensitive sent" };
      }
      case "vendor_reply": {
        const { provider } = await runReply(c);
        const left = leaked(provider.draftUser ?? "", c.sensitive);
        return { case: c, actual: toDecision(left.length === 0), detail: left.length ? `sent to vendor: ${left.join(", ")}` : "nothing sensitive sent" };
      }
    }
  } catch (e) {
    return { case: c, actual: "allow", detail: "evaluator threw", error: e instanceof Error ? e.message : String(e) };
  }
}

export async function evaluateAll(cases: EvalCase[]): Promise<CaseResult[]> {
  const out: CaseResult[] = [];
  for (const c of cases) out.push(await evaluate(c));
  return out;
}

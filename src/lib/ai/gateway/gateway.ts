import { createHash } from "node:crypto";

import { ENV_FLAG_BY_AGENT } from "@/lib/agents/enabled";
import type { ChatBlock, ChatMessage, LlmRequest, LlmResponse } from "@/lib/ai/provider";

import { isProduction } from "./config";
import { approxTokens, estimateCostUsd } from "./pricing";
import { consentRequirement, getPurpose, type PurposeDef } from "./purposes";
import { findSensitive, redact as defaultRedact, type RedactOptions, type RedactionSummary } from "./redact";
import {
  ABSTAIN_REASONS,
  NotConfiguredError,
  type AbstainReason,
  type AgentRunRecord,
  type BlockReason,
  type CallInput,
  type ErrorClass,
  type EvalVerdict,
  type GatewayDeps,
  type GatewayResult,
  type Route,
} from "./types";

/**
 * callModel(): the ONE way application code calls a model. Order of the gates, each failing closed:
 *   purpose registered > kill switch > input > caller signals (abstain) > consent for the data class > redaction (+ last check)
 *   > daily budget (hard cap) > provider call (timeout, bounded retry with backoff) > abstain protocol > evaluation hook > trace.
 * Every outcome, including a refusal, leaves one AgentRun row (ids, classes and counts: never the prompt or the output).
 * Application code must not import a model SDK or the provider factories; scripts/ci/ai-boundary.mjs fails the build if it does.
 */

const RETRYABLE: ReadonlySet<ErrorClass> = new Set(["rate_limited", "provider_error", "network", "timeout"]);
const BACKOFF_BASE_MS = 400;
const BACKOFF_CAP_MS = 4000;
const DEFAULT_RETENTION_DAYS = 90;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const PAN = /\b[A-Z]{5}\s?\d{4}\s?[A-Z]\b/i;

export const AI_KILL_SWITCH = "AI_KILL_SWITCH";

/** Start of the current Indian day, as a UTC instant: the budget window. */
export function budgetDayStart(now: Date): Date {
  const ist = now.getTime() + IST_OFFSET_MS;
  return new Date(Math.floor(ist / 86_400_000) * 86_400_000 - IST_OFFSET_MS);
}

/** The purpose's daily cap in USD, or null when none is set. AI_PURPOSE_BUDGETS_USD ("id=usd,id=usd") wins over AI_BUDGET_DEFAULT_USD. A malformed number is a cap of 0 (fail closed). */
export function budgetFor(purposeId: string, env: Record<string, string | undefined>): number | null {
  const parse = (v: string) => (/^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : 0);
  for (const part of (env.AI_PURPOSE_BUDGETS_USD ?? "").split(",")) {
    const [id, value] = part.split("=");
    if (id?.trim() === purposeId && value !== undefined) return parse(value);
  }
  return env.AI_BUDGET_DEFAULT_USD !== undefined && env.AI_BUDGET_DEFAULT_USD !== "" ? parse(env.AI_BUDGET_DEFAULT_USD) : null;
}

export function retentionDays(env: Record<string, string | undefined>): number {
  const n = Number(env.AI_RUN_RETENTION_DAYS);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_RETENTION_DAYS;
}

export function classifyError(e: unknown): ErrorClass {
  if (e instanceof NotConfiguredError) return "not_configured";
  const err = e as { status?: number; code?: string; name?: string; message?: string };
  if (err?.name === "GatewayTimeout" || /timeout|abort/i.test(err?.name ?? "") || err?.code === "ETIMEDOUT" || err?.status === 408 || /timed? ?out/i.test(err?.message ?? "")) return "timeout";
  if (err?.status === 429) return "rate_limited";
  if (typeof err?.status === "number" && err.status >= 500) return "provider_error";
  if (typeof err?.status === "number" && err.status >= 400) return "invalid_request";
  if (["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EPIPE"].includes(err?.code ?? "") || /fetch failed|network|connection/i.test(err?.message ?? "")) return "network";
  return "unknown";
}

const personalLooking = (id: string) => /@/.test(id) || /^\+?[\d\s().-]{6,}$/.test(id) || PAN.test(id);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const timer = new Promise<never>((_, reject) => { t = setTimeout(() => reject(Object.assign(new Error("model call timed out"), { name: "GatewayTimeout" })), ms); });
  return Promise.race([p, timer]).finally(() => clearTimeout(t));
}

function resolveRoute(p: PurposeDef, env: Record<string, string | undefined>, apiKey?: string): Route {
  const pinned = p.route?.(env);
  const provider = pinned?.provider ?? env.AI_PROVIDER ?? "anthropic";
  const model = pinned?.model ?? env.AGENT_MODEL ?? (provider === "openai" ? env.OPENAI_SUMMARY_MODEL || "gpt-4o-mini" : provider === "fake" ? "fake" : "claude-sonnet-5-5");
  return { provider, model, ...(apiKey ? { apiKey } : {}) };
}

/** Redacts every string the vendor will see: the user turn, conversation turns and tool results. Tool definitions and the system prompt are code, not data. */
function redactRequest(input: CallInput, p: PurposeDef, deps: GatewayDeps): { user: string | undefined; messages: ChatMessage[] | undefined; summary: RedactionSummary; leaked: boolean } {
  const opts: RedactOptions = { allowContactIdentifiers: p.allowContactIdentifiers, allowNames: p.allowNames, knownNames: input.subject?.knownNames };
  const run = deps.redact ?? defaultRedact;
  const summary: RedactionSummary = {};
  let leaked = false;
  const one = (text: string): string => {
    const r = run(text, opts);
    for (const [k, n] of Object.entries(r.summary)) summary[k as keyof RedactionSummary] = (summary[k as keyof RedactionSummary] ?? 0) + (n ?? 0);
    if (findSensitive(r.text, opts).length > 0) leaked = true;
    return r.text;
  };
  const user = input.user === undefined ? undefined : one(input.user);
  const messages = input.messages?.map((m): ChatMessage => ({
    role: m.role,
    content: typeof m.content === "string" ? (m.role === "user" ? one(m.content) : m.content) : m.content.map((b): ChatBlock => (b.type === "text" && m.role === "user" ? { ...b, text: one(b.text) } : b.type === "tool_result" ? { ...b, content: one(b.content) } : b)),
  }));
  return { user, messages, summary, leaked };
}

const totalChars = (input: CallInput, user: string | undefined, messages: ChatMessage[] | undefined) =>
  (input.system?.length ?? 0) + (user?.length ?? 0) + (messages ? JSON.stringify(messages).length : 0) + (input.tools ? JSON.stringify(input.tools).length : 0);

export async function callModel(input: CallInput, deps: GatewayDeps): Promise<GatewayResult> {
  const started = deps.now();
  const t0 = Date.now();
  const correlationId = input.correlationId ?? deps.newId();
  const lookup = deps.purposeLookup ?? getPurpose;
  const purpose = lookup(input.purpose);
  const env = deps.env;

  const subject = input.subject && !personalLooking(input.subject.id) ? { type: input.subject.type, id: input.subject.id } : null;
  let redactionSummary: RedactionSummary | null = null;
  let provider = "none";
  let model = "none";
  let usage = { inputTokens: 0, outputTokens: 0, costUsdEstimate: 0 };
  let attempts = 0;

  const finish = async (status: AgentRunRecord["status"], extra: Partial<AgentRunRecord> = {}): Promise<string | null> => {
    const run: AgentRunRecord = {
      agentKey: purpose?.agentKey ?? null,
      purposeId: input.purpose,
      provider, model,
      promptId: purpose?.prompt.id ?? input.purpose,
      promptVersion: purpose?.prompt.version ?? "0",
      promptHash: input.system ? createHash("sha256").update(input.system).digest("hex").slice(0, 16) : null,
      inputClass: purpose?.dataClass ?? "none",
      redactionSummary: redactionSummary && Object.keys(redactionSummary).length ? (redactionSummary as Record<string, number>) : null,
      ...usage,
      latencyMs: Date.now() - t0,
      attempts,
      status,
      reasonCode: null, errorClass: null, evalOutcome: null,
      approvalRef: input.approvalRef ?? null,
      correlationId, causationId: input.causationId ?? null,
      subjectType: subject?.type ?? null, subjectId: subject?.id ?? null,
      retainUntil: new Date(started.getTime() + retentionDays(env) * 86_400_000),
      ...extra,
    };
    try { return await deps.record(run); } catch (e) { deps.warn(`AI gateway: could not store the trace for ${input.purpose}: ${e instanceof Error ? e.message : "error"}`); return null; }
  };
  const blocked = async (reason: BlockReason, detail?: string): Promise<GatewayResult> => ({ kind: "blocked", reason, detail, correlationId, runId: await finish("blocked", { reasonCode: reason }) });
  const abstain = async (reason: AbstainReason, detail?: string): Promise<GatewayResult> => ({ kind: "abstain", reason, detail, correlationId, runId: await finish("abstained", { reasonCode: reason }) });

  if (!purpose) return blocked("purpose_unregistered", `"${input.purpose}" is not a registered purpose`);

  // 1. Kill switches. Global first, then the owning agent's own (env flag AND an enabled AgentSetting). A lookup that fails means off.
  if (env[AI_KILL_SWITCH] === "1") return blocked("kill_switch", "AI_KILL_SWITCH is on");
  if (purpose.agentKey && ENV_FLAG_BY_AGENT[purpose.agentKey]) {
    let on = false;
    try { on = await deps.agentEnabled(purpose.agentKey); } catch { on = false; }
    if (!on) return blocked("kill_switch", `agent ${purpose.agentKey} is switched off`);
  }

  // 2. Input.
  if (input.user === undefined && !input.messages?.length) return blocked("invalid_input", "nothing to send");

  // 3. Things the caller already knows that mean the model should not be asked.
  const sig = input.signals;
  if (sig?.doNotContact) return abstain("do_not_contact");
  if (sig?.humanReviewRequired) return abstain("human_review_required");
  if (sig?.evidenceConflict) return abstain("evidence_conflict");
  if (sig?.dataAsOf && purpose.freshnessMs !== undefined && started.getTime() - sig.dataAsOf.getTime() > purpose.freshnessMs) return abstain("data_stale");

  // 4. Consent for the customer data class: required, the subject must be the customer, and an unreadable ledger means no.
  const need = consentRequirement(purpose);
  if (need) {
    if (!input.subject || input.subject.type !== "client" || !input.subject.id) return blocked("consent_subject_missing", `purpose ${purpose.id} needs the customer as subject`);
    let verdict;
    try { verdict = await deps.consent(input.subject.id, need.purpose, need.channel); } catch { return blocked("consent_unavailable", "the consent ledger could not be read"); }
    if (!verdict.allowed) return verdict.reason === "DO_NOT_CONTACT" ? abstain("do_not_contact") : blocked("consent_denied", verdict.reason);
  }

  // 5. Redaction, then a last check that nothing the purpose may not receive is still there.
  const red = redactRequest(input, purpose, deps);
  redactionSummary = red.summary;
  if (red.leaked) return blocked("redaction_failed", "sensitive text survived redaction");

  // 6. Route, and the budget: a hard cap checked against spend so far plus the worst case for this call.
  const route = resolveRoute(purpose, env, input.apiKey);
  provider = route.provider; model = route.model;
  if (route.provider === "fake" && isProduction(env)) return { kind: "failed", errorClass: "not_configured", retryable: false, attempts: 0, correlationId, runId: await finish("failed", { errorClass: "not_configured" }) };
  const cap = budgetFor(purpose.id, env);
  if (cap === null) {
    if (isProduction(env)) return blocked("budget_unset", `no daily budget is set for ${purpose.id}`);
    deps.warn(`AI gateway: no daily budget is set for ${purpose.id}; allowed because this is not production. Set AI_PURPOSE_BUDGETS_USD or AI_BUDGET_DEFAULT_USD.`);
  } else {
    let spent: number;
    try { spent = await deps.spentToday(purpose.id, budgetDayStart(started)); } catch { return blocked("budget_unavailable", "today's spend could not be read"); }
    const maxTokens = input.maxTokens ?? purpose.maxTokens;
    const worst = estimateCostUsd(route.model, approxTokens(totalChars(input, red.user, red.messages)), maxTokens);
    if (spent >= cap || spent + worst > cap) return blocked("budget_exceeded", `${purpose.id}: ${spent.toFixed(4)} spent of ${cap} today`);
  }

  // 7. The call: timeout enforced here, vendor retries off, bounded retry with backoff on retryable failures only.
  const timeoutMs = input.timeoutMs ?? purpose.timeoutMs;
  const req: LlmRequest = {
    system: input.system ?? "", user: red.user ?? "", maxTokens: input.maxTokens ?? purpose.maxTokens, timeoutMs, maxRetries: 0,
    ...(red.messages ? { messages: red.messages } : {}), ...(input.tools ? { tools: input.tools } : {}), ...(input.toolChoice ? { toolChoice: input.toolChoice } : {}),
    ...(route.model ? { model: route.model } : {}),
  };
  let res: LlmResponse | null = null;
  let lastClass: ErrorClass = "unknown";
  for (attempts = 1; attempts <= Math.max(1, purpose.maxAttempts); attempts += 1) {
    try {
      res = await withTimeout(deps.providerFor(route).complete(req), timeoutMs);
      break;
    } catch (e) {
      lastClass = classifyError(e);
      if (!RETRYABLE.has(lastClass) || attempts >= Math.max(1, purpose.maxAttempts)) break;
      await deps.sleep(Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempts - 1)));
    }
  }
  if (!res) {
    attempts = Math.min(attempts, Math.max(1, purpose.maxAttempts));
    return { kind: "failed", errorClass: lastClass, retryable: RETRYABLE.has(lastClass), attempts, correlationId, runId: await finish("failed", { errorClass: lastClass }) };
  }

  usage = { inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsdEstimate: estimateCostUsd(res.model || route.model, res.inputTokens, res.outputTokens) };
  model = res.model || route.model;

  // 8. A model's own decision not to answer is an outcome, not an error.
  if (purpose.abstainProtocol) {
    const m = /^\s*ABSTAIN\s*(?::\s*([a-z_]+))?/i.exec(res.text);
    if (m) {
      const named = (m[1] ?? "").toLowerCase();
      return abstain((ABSTAIN_REASONS as readonly string[]).includes(named) ? (named as AbstainReason) : "do_not_know");
    }
  }

  // 9. The evaluation hook sees the output only. It records; it never fails the call.
  let verdict: EvalVerdict | undefined;
  let evalOutcome: AgentRunRecord["evalOutcome"] = null;
  if (input.evaluate) {
    try { verdict = await input.evaluate({ text: res.text, toolUses: res.toolUses ?? [] }); evalOutcome = verdict.pass ? "pass" : "fail"; } catch { evalOutcome = "error"; }
  }

  const runId = await finish("ok", { evalOutcome });
  return {
    kind: "ok", text: res.text, toolUses: res.toolUses ?? [], blocks: res.blocks ?? (res.text ? [{ type: "text", text: res.text }] : []), stopReason: res.stopReason,
    provider, model, usage, ...(verdict ? { eval: verdict } : {}), runId, correlationId,
  };
}

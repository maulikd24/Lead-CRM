import { FakeProvider, type LlmProvider } from "@/lib/ai/provider";
import { callModel } from "@/lib/ai/gateway/gateway";
import { getPurpose, type PurposeDef } from "@/lib/ai/gateway/purposes";
import type { AgentRunRecord, GatewayDeps, GatewayResult } from "@/lib/ai/gateway/types";

import type { CaseResult, GatewaySpec } from "./types";

/** Same fixed clock as evaluate.ts. */
const NOW = new Date("2026-10-09T10:00:00Z");

/** Gateway wiring for evals: deterministic, offline, in memory. */
export function evalGatewayDeps(provider: LlmProvider, over: Partial<GatewayDeps> = {}): { deps: GatewayDeps; records: AgentRunRecord[] } {
  const records: AgentRunRecord[] = [];
  let n = 0;
  return {
    records,
    deps: {
      env: { AI_BUDGET_DEFAULT_USD: "1000" },
      now: () => NOW,
      newId: () => `eval-${++n}`,
      sleep: async () => {},
      providerFor: () => provider,
      agentEnabled: async () => true,
      consent: async () => ({ allowed: true, reason: "GRANTED" }),
      spentToday: async () => 0,
      record: async (r) => { records.push(r); return `run-${records.length}`; },
      warn: () => {},
      ...over,
    },
  };
}

const outcomeOf = (r: GatewayResult) => (r.kind === "ok" ? "ok" : r.kind === "blocked" ? `blocked:${r.reason}` : r.kind === "abstain" ? `abstain:${r.reason}` : `failed:${r.errorClass}`);

export async function runGatewaySpec(c: GatewaySpec & { id: string; category: string; lang: "en" | "hinglish" | "hi"; expect: "block" | "allow"; note?: string; known?: string }): Promise<CaseResult> {
  const rate = Object.assign(new Error("slow down"), { status: 429 });
  let failures = 0;
  const fake = new FakeProvider(() => {
    if (c.provider === "rate_limit") return rate;
    if (c.provider === "rate_limit_then_ok") return failures++ < 1 ? rate : (c.reply ?? "fine");
    if (c.provider === "bad_request") return Object.assign(new Error("bad"), { status: 400 });
    return c.reply ?? "fine";
  });
  const hang: LlmProvider = { name: "fake", complete: () => new Promise<never>(() => {}) };
  const { deps } = evalGatewayDeps(c.provider === "hang" ? hang : fake, {
    env: { AI_BUDGET_DEFAULT_USD: "1000", ...c.env },
    agentEnabled: async () => { if (c.agentOff === "error") throw new Error("setting lookup failed"); return !c.agentOff; },
    ...(c.leakyRedactor ? { redact: (t: string) => ({ text: t, summary: {} }) } : {}),
    consent: async () => {
      if (c.consent === "denied") return { allowed: false, reason: "WITHDRAWN" };
      if (c.consent === "dnc") return { allowed: false, reason: "DO_NOT_CONTACT" };
      if (c.consent === "error") throw new Error("ledger down");
      return { allowed: true, reason: "GRANTED" };
    },
    spentToday: async () => { if (c.spent === "error") throw new Error("db down"); return c.spent ?? 0; },
    purposeLookup: (id) => {
      const p = getPurpose(id);
      return p ? ({ ...p, ...(c.freshnessHours !== undefined ? { freshnessMs: c.freshnessHours * 3600_000 } : {}), ...(c.abstainProtocol ? { abstainProtocol: true } : {}) } as PurposeDef) : undefined;
    },
  });
  const sg = c.signals;
  const r = await callModel({
    purpose: c.purpose, system: "scripted system prompt", user: c.user, timeoutMs: c.provider === "hang" ? 20 : undefined,
    ...(c.noSubject ? {} : { subject: { type: "client", id: "c1" } }),
    ...(sg ? { signals: { evidenceConflict: sg.evidenceConflict, doNotContact: sg.doNotContact, humanReviewRequired: sg.humanReviewRequired, ...(sg.dataAsOfHoursAgo !== undefined ? { dataAsOf: new Date(NOW.getTime() - sg.dataAsOfHoursAgo * 3600_000) } : {}) } } : {}),
  }, deps);
  const outcome = outcomeOf(r);
  const sent = fake.calls.map((x) => x.user).join("\n");
  const leaked = (c.mustNotSend ?? []).filter((t) => sent.includes(t));
  const missing = (c.mustSend ?? []).filter((t) => !sent.includes(t));
  const intervened = outcome !== "ok" || ((c.mustNotSend ?? []).length > 0 && leaked.length === 0);
  const wrong = c.expectCalls !== undefined && fake.calls.length !== c.expectCalls ? `vendor called ${fake.calls.length} time(s), wanted ${c.expectCalls}` : outcome !== c.expectOutcome ? `outcome ${outcome}, wanted ${c.expectOutcome}` : leaked.length ? `sent to the model: ${leaked.join(", ")}` : missing.length ? `lost before the model: ${missing.join(", ")}` : null;
  const calledModel = fake.calls.length > 0;
  const detail = `${outcome}${calledModel ? "" : " (model not called)"}`;
  return { case: c, actual: leaked.length ? "allow" : intervened ? "block" : "allow", detail, ...(wrong ? { error: wrong } : {}) };
}

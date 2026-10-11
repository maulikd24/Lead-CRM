import type { LlmProvider, LlmRequest, LlmResponse } from "@/lib/ai/provider";

import { callModel } from "./gateway";
import type { GatewayDeps, GatewayResult } from "./types";
import { defaultGatewayDeps } from "./wiring";

/** Thrown by the adapter when the gateway did not return a result (blocked, abstained or failed). Callers' existing catch-blocks treat it as a provider error: no draft, judge unavailable. */
export class GatewayRefusal extends Error {
  constructor(readonly result: Exclude<GatewayResult, { kind: "ok" }> | { kind: "blocked"; reason: "purpose_unregistered"; correlationId: string; runId: null }) {
    super(`AI gateway refused the call: ${result.kind}${"reason" in result ? ` (${result.reason})` : "errorClass" in result ? ` (${result.errorClass})` : ""}`);
    this.name = "GatewayRefusal";
  }
}

/**
 * An LlmProvider whose every call goes through callModel(). The agents (nudger, reply assist, social drafter, the judge) already
 * take an LlmProvider, so they are migrated by handing them this instead of a raw provider; their code and tests are unchanged.
 * Each request must say what it is for (`req.gateway.purpose`); without one the call is refused.
 */
export class GatewayProvider implements LlmProvider {
  constructor(private readonly opts: { apiKey?: string; deps?: () => GatewayDeps } = {}) {}
  private get deps(): GatewayDeps { return this.opts.deps ? this.opts.deps() : defaultGatewayDeps(); }
  get name(): string { return process.env.AI_PROVIDER ?? "anthropic"; }
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const g = req.gateway;
    if (!g?.purpose) throw new GatewayRefusal({ kind: "blocked", reason: "purpose_unregistered", correlationId: "", runId: null });
    const r = await callModel({
      purpose: g.purpose, system: req.system, user: req.messages ? undefined : req.user, messages: req.messages, tools: req.tools, toolChoice: req.toolChoice,
      maxTokens: req.maxTokens, timeoutMs: req.timeoutMs, subject: g.subject, correlationId: g.correlationId, causationId: g.causationId, apiKey: this.opts.apiKey,
    }, this.deps);
    if (r.kind !== "ok") throw new GatewayRefusal(r);
    return { text: r.text, model: r.model, inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, toolUses: r.toolUses, stopReason: r.stopReason, blocks: r.blocks };
  }
}

/** The provider application code uses. `apiKey` is the key an Admin saved in Settings (the reply-assist pilot). */
export const gatewayProvider = (opts: { apiKey?: string } = {}): LlmProvider => new GatewayProvider(opts);

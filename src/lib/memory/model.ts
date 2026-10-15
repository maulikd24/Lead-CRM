// The model seam of memory extraction, on the AI gateway: every call is callModel() under the registered purpose "memory.extract" (agent memory_extractor, draft only).
// The gateway checks the global and per-agent kill switches, the customer's AI-processing consent, the budget, redaction and the ABSTAIN protocol; this file only
// adapts its result to the small `complete()` contract that refineWithModel (and its evals, which use a FakeProvider) already speak.
import { callModel, GatewayRefusal } from "@/lib/ai/gateway";
import type { GatewayDeps } from "@/lib/ai/gateway";

import type { MemoryModel } from "./propose";

export const MEMORY_EXTRACT_PURPOSE = "memory.extract";

export function gatewayMemoryModel(clientId: string, deps?: GatewayDeps, correlationId?: string): MemoryModel {
  return {
    async complete(req) {
      const r = await callModel({ purpose: "memory.extract", system: req.system, user: req.user, maxTokens: req.maxTokens, timeoutMs: req.timeoutMs, subject: { type: "client", id: clientId }, correlationId }, deps);
      if (r.kind !== "ok") throw new GatewayRefusal(r);
      return { text: r.text, model: r.model, inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, toolUses: r.toolUses, stopReason: r.stopReason, blocks: r.blocks };
    },
  };
}

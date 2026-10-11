import { emitAutopilotApplied, emitAutopilotApplyFailed, emitAutopilotApproved, emitAutopilotDenied } from "@/lib/events/producers-emit";

import type { DecisionDeps } from "./decisions";
import { getActionProvider } from "./provider";
import * as store from "./store";

/** Production wiring for the decision path: the database store, the guarded action provider (unconfigured and switched off by default) and the event emitters. */
export function decisionDeps(env: Record<string, string | undefined> = process.env): DecisionDeps {
  return {
    getRec: store.getRecommendation,
    recordDecision: store.recordDecision,
    claimApply: store.claimApply,
    markApplied: store.markApplied,
    provider: getActionProvider(env),
    emit: async (kind, e) => {
      if (kind === "approved") await emitAutopilotApproved(e);
      else if (kind === "denied") await emitAutopilotDenied(e);
      else if (kind === "applied") await emitAutopilotApplied(e);
      else await emitAutopilotApplyFailed(e);
    },
  };
}

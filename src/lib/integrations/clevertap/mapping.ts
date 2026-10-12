import type { IntelligenceResult } from "@/lib/intelligence/refresh";
import type { CustomerSignals } from "./signals";

const FUNDED_STAGES = new Set(["Funded", "Activated", "Active"]);
const LEVELS = new Set(["HIGH", "MEDIUM", "LOW"]);

/** Pure mapping from the intelligence engines' output to the allowlisted CleverTap signals. */
export function signalsFromIntelligence(result: Pick<IntelligenceResult, "lifecycle" | "facts" | "acceptance" | "situations" | "nba">): CustomerSignals {
  const acceptance: CustomerSignals["acceptance"] = {};
  for (const [asset, entry] of Object.entries(result.acceptance ?? {})) {
    const level = (entry as { level?: unknown } | undefined)?.level;
    if (typeof level === "string" && LEVELS.has(level)) acceptance[asset] = level as "HIGH" | "MEDIUM" | "LOW";
  }
  return {
    lifecycleStage: result.lifecycle,
    kycApproved: result.facts.kycApproved,
    funded: FUNDED_STAGES.has(result.lifecycle),
    nbaProgramme: result.nba?.programme ?? null,
    priority: result.nba?.priority ?? null,
    acceptance,
    salesPaused: (result.situations ?? []).some((s) => s.key === "service_issue"),
  };
}

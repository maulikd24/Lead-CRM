// Builders for tests (not imported by production code).
import { ENGINE_CONFIG, FRESHNESS } from "./constants";
import type { Candidate } from "./types";

export const NOW = new Date("2026-10-11T10:00:00.000Z");
export const hoursAgo = (h: number, from = NOW) => new Date(from.getTime() - h * 3600 * 1000);
export const daysAgo = (d: number, from = NOW) => hoursAgo(d * 24, from);
export const daysAhead = (d: number, from = NOW) => new Date(from.getTime() + d * 24 * 3600 * 1000);

export function cand(over: Partial<Candidate> = {}): Candidate {
  return {
    id: over.id ?? "intelligence_nba:pms",
    source: "intelligence_nba",
    programme: "PMS / AIF opportunity",
    action: "Call",
    topic: "PMS",
    assetClass: "PMS",
    reason: "PMS acceptance is high for this customer.",
    priority: "Medium",
    owner: "RM",
    channel: "call",
    timing: "This Week",
    sales: true,
    serviceRecovery: false,
    bonuses: [],
    evidence: [{ kind: "fact", ref: "acceptance:PMS", text: "PMS acceptance high", observedAt: NOW.toISOString(), confirmation: "confirmed" }],
    asOf: NOW,
    freshness: { ...FRESHNESS.rule },
    inferredOnly: false,
    ruleKey: "intelligence_nba.pms",
    fingerprint: "PMS",
    productRefs: [],
    legacyChosen: true,
    ...over,
  };
}

export const CFG = ENGINE_CONFIG;

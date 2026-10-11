// The disagreement log: what the new engine concluded versus what the current v1 engine (lib/intelligence/nba.ts) concluded.
// "Material" is the one that matters: the new engine is LESS careful than the old one (it recommends something the old one told the
// RM not to raise). Everything else is information about how the two differ.
import type { DecisionDraft, LegacyOpinion } from "./types";

export type DisagreementKind = "same" | "action_differs" | "programme_differs" | "v2_holds_back" | "v2_abstains" | "suppression_regression" | "no_legacy";
export type DisagreementSeverity = "none" | "info" | "minor" | "material";

export type Disagreement = { agrees: boolean; kind: DisagreementKind; severity: DisagreementSeverity; summary: string };

const NO_ACTION = "No Action / Do Not Pitch";

/** True when the legacy engine told the RM not to raise what the new engine now recommends. */
function breaksLegacyDoNotDiscuss(v2: DecisionDraft, legacy: LegacyOpinion): string | null {
  const salesBlock = legacy.doNotDiscuss.find((d) => /^Sales topics/i.test(d));
  const isSales = v2.assetClass !== null || ["Demat portfolio transfer", "Mutual fund portfolio transfer", "Portfolio rebalance", "MF / SIP opportunity", "PMS / AIF opportunity", "Broking activation / reactivation", "Tax-planning discussion", "First transaction"].includes(v2.programme);
  if (salesBlock && isSales) return salesBlock;
  if (v2.assetClass) {
    const hit = legacy.doNotDiscuss.find((d) => d.startsWith(`${v2.assetClass}:`));
    if (hit) return hit;
  }
  return null;
}

export function compareToLegacy(v2: DecisionDraft, legacy: LegacyOpinion | null): Disagreement {
  if (!legacy) return { agrees: true, kind: "no_legacy", severity: "none", summary: "No legacy opinion to compare with." };
  const legacyActs = legacy.action !== "No Action";
  if (v2.result === "RECOMMEND") {
    const breach = breaksLegacyDoNotDiscuss(v2, legacy);
    if (breach) return { agrees: false, kind: "suppression_regression", severity: "material", summary: `New engine recommends ${v2.programme}; the current engine said not to raise it: ${breach}` };
    if (legacy.programme === v2.programme && legacy.action === v2.action) return { agrees: true, kind: "same", severity: "none", summary: "Same programme and action." };
    if (legacy.programme === v2.programme) return { agrees: false, kind: "action_differs", severity: "minor", summary: `Same programme (${v2.programme}), ${legacy.action} became ${v2.action}.` };
    return { agrees: false, kind: "programme_differs", severity: "minor", summary: `Current engine: ${legacy.programme}. New engine: ${v2.programme}.` };
  }
  if (v2.result === "ABSTAIN") return { agrees: false, kind: "v2_abstains", severity: "info", summary: `New engine abstains (${v2.abstainReason}); the current engine said ${legacy.programme}.` };
  // NO_ACTION
  if (!legacyActs || legacy.programme === NO_ACTION) return { agrees: true, kind: "same", severity: "none", summary: "Both say no action." };
  return { agrees: false, kind: "v2_holds_back", severity: "info", summary: `New engine holds back; the current engine said ${legacy.programme}.` };
}

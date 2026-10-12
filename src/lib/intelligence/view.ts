import { refreshCustomerIntelligence, type IntelligenceResult } from "./refresh";
import { ASSET_CLASSES, type AssetClass } from "./constants";

export type IntelligenceView = {
  lifecycle: string;
  category: string | null;
  computedAtIso: string;
  nba: { programme: string; action: string; topic: string | null; reason: string; priority: string; owner: string; timing: string; talkingPoints: string[]; doNotDiscuss: string[] };
  situations: { key: string; label: string; severity: string; detail: string }[];
  acceptance: { assetClass: AssetClass; level: "HIGH" | "MEDIUM" | "LOW"; source: string; reason: string; isManual: boolean }[];
  commitments: { id: string; text: string; dueAtIso: string | null; overdue: boolean }[];
  issues: { id: string; kind: string; text: string; severity: string | null; dateIso: string }[];
  said: { id: string; kind: string; assetClass: string | null; text: string; dateIso: string }[];
  estimates: { externalPortfolio: number | null; mfTransfer: number | null; idleCash: number | null; dematTransferStatus: string | null; mfTransferStatus: string | null};
  outcomes: { outcome: string; assetClass: string | null; createdAtIso: string }[];
};

/** Pure: shapes an already computed result as plain serialisable data. No reads, no writes. */
export function toIntelligenceView(result: IntelligenceResult): IntelligenceView {
  const { facts, lifecycle, acceptance, situations, nba } = result;
  const now = facts.now;

  const open = facts.insights.filter((i) => i.status === "OPEN");
  return {
    lifecycle,
    category: facts.client.customerCategory,
    computedAtIso: now.toISOString(),
    nba: { programme: nba.programme, action: nba.action, topic: nba.topic, reason: nba.reason, priority: nba.priority, owner: nba.owner, timing: nba.timing, talkingPoints: nba.talkingPoints, doNotDiscuss: nba.doNotDiscuss },
    situations: situations.map((s) => ({ key: s.key, label: s.label, severity: s.severity, detail: s.detail })),
    acceptance: ASSET_CLASSES.map((assetClass) => ({
      assetClass,
      level: acceptance[assetClass].level,
      source: acceptance[assetClass].source,
      reason: acceptance[assetClass].reason,
      isManual: acceptance[assetClass].source === "manual",
    })),
    commitments: open.filter((i) => i.kind === "COMMITMENT").map((i) => ({ id: i.id, text: i.text, dueAtIso: i.dueAt?.toISOString() ?? null, overdue: !!i.dueAt && i.dueAt < now })),
    issues: open
      .filter((i) => ["COMPLAINT", "INCORRECT_INFO", "COMPLIANCE_CONCERN", "MISSED_OPPORTUNITY"].includes(i.kind))
      .map((i) => ({ id: i.id, kind: i.kind, text: i.text, severity: i.severity, dateIso: i.occurredAt.toISOString() })),
    said: facts.insights
      .filter((i) => ["INTEREST", "OBJECTION", "CONCERN", "QUESTION", "DECLINED", "EXTERNAL_HOLDING"].includes(i.kind))
      .slice(0, 8)
      .map((i) => ({ id: i.id, kind: i.kind, assetClass: i.assetClass, text: i.text, dateIso: i.occurredAt.toISOString() })),
    estimates: {
      externalPortfolio: facts.intel.externalPortfolio,
      mfTransfer: facts.intel.mfTransfer,
      idleCash: facts.intel.idleCash,
      dematTransferStatus: facts.intel.dematTransferStatus,
      mfTransferStatus: facts.intel.mfTransferStatus
    },
    outcomes: facts.outcomes.slice(0, 5).map((o) => ({ outcome: o.outcome, assetClass: o.assetClass, createdAtIso: o.createdAt.toISOString() })),
  };
}

/** Recomputes (and persists, as before) then returns everything the client page's Intelligence card shows. */
export async function getIntelligenceView(clientId: string): Promise<IntelligenceView | null> {
  const result = await refreshCustomerIntelligence(clientId);
  return result ? toIntelligenceView(result) : null;
}

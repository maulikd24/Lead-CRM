import { formatInrCompact } from "./count-up";

export type AcceptanceRow = { assetClass: string; level: "HIGH" | "MEDIUM" | "LOW"; source: string; reason: string; isManual: boolean };
export type AcceptanceChip = { assetClass: string; level: AcceptanceRow["level"]; heat: 1 | 2 | 3; levelLabel: string; reason: string; isManual: boolean; label: string };

const HEAT = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const;
const LEVEL_LABEL = { HIGH: "High", MEDIUM: "Medium", LOW: "Low" } as const;

export function buildAcceptanceChips(rows: AcceptanceRow[]): AcceptanceChip[] {
  return rows.map((r) => ({
    assetClass: r.assetClass,
    level: r.level,
    heat: HEAT[r.level],
    levelLabel: LEVEL_LABEL[r.level],
    reason: r.reason,
    isManual: r.isManual,
    label: `${r.assetClass}: ${LEVEL_LABEL[r.level]} acceptance. ${r.reason}${r.isManual ? " (set by RM)" : ""}`,
  }));
}

export type Callout = { key: "concentration" | "idle" | "external"; label: string; value: string; tone: "default" | "warning"; hint: string };

export function buildCallouts(input: { concentration: { label: string; hhi: number } | null; idleCash: number | null; externalPortfolio: number | null }): Callout[] {
  const out: Callout[] = [];
  if (input.concentration) {
    const flagged = input.concentration.label !== "Diversified";
    out.push({ key: "concentration", label: "Concentration", value: input.concentration.label, tone: flagged ? "warning" : "default", hint: "How evenly the portfolio is spread across asset classes." });
  }
  if (input.idleCash && input.idleCash > 0) out.push({ key: "idle", label: "Idle cash", value: formatInrCompact(input.idleCash), tone: "default", hint: "An estimate of cash not yet invested." });
  if (input.externalPortfolio && input.externalPortfolio > 0) out.push({ key: "external", label: "Held elsewhere", value: formatInrCompact(input.externalPortfolio), tone: "default", hint: "An estimate of holdings outside Allvest." });
  return out;
}

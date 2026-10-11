import type { Confidence, LedgerEntry, Phase } from "./types";

/** Display helpers for the ledger screens. Pure, so they are unit tested and the server and client markup always agree (a fixed time zone and locale). */

const WHEN = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
export const formatWhen = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : WHEN.format(d).replace(/\bam\b/, "am").replace(/\bpm\b/, "pm");
};

/** A confidence in plain words. The score is a fixed heuristic rank, not a probability, and the text says so. */
export function confidenceText(confidence: Confidence, score: number): string {
  if (confidence === "certain") return "Certain: every link is an id the records carry";
  const band = score >= 0.7 ? "medium" : score >= 0.5 ? "low to medium" : "low";
  return `Inferred, ${band} confidence (${score.toFixed(1)} of 1, a rank and not a probability)`;
}

export const confidenceShort = (confidence: Confidence): string => (confidence === "certain" ? "Certain" : "Inferred");

/** The phases that have at least one step, in order, with their steps. */
export function groupChain(entry: Pick<LedgerEntry, "chain">, order: readonly Phase[]): { phase: Phase; steps: LedgerEntry["chain"] }[] {
  return order.map((phase) => ({ phase, steps: entry.chain.filter((s) => s.phase === phase) })).filter((g) => g.steps.length > 0);
}

export const approvalTone = (state: LedgerEntry["approval"]["state"]): "success" | "warning" | "destructive" | "secondary" | "outline" =>
  state === "executed" || state === "approved" ? "success" : state === "rejected" || state === "failed" ? "destructive" : state === "requested" || state === "expired" || state === "cancelled" ? "warning" : "outline";

export const resultTone = (tone: "positive" | "neutral" | "warning" | "negative"): "success" | "warning" | "destructive" | "secondary" => (tone === "positive" ? "success" : tone === "warning" ? "warning" : tone === "negative" ? "destructive" : "secondary");

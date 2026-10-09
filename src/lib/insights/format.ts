/** Small display helpers shared by the insights page and its tests. */

export const fmtPct = (v: number | null): string => (v === null ? "—" : `${Math.round(v * 100)}%`);

export function fmtDuration(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 1) return "under 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 60 * 48) return `${(minutes / 60).toFixed(1)} h`;
  return `${(minutes / 60 / 24).toFixed(1)} days`;
}

export const fmtRatio = (part: number, whole: number): string => `${part} of ${whole}`;

const AGENT_LABELS: Record<string, string> = { wa_nudger: "WhatsApp nudger" };

export function agentLabel(key: string): string {
  if (AGENT_LABELS[key]) return AGENT_LABELS[key];
  const spaced = key.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function trendLabel(trend: "up" | "down" | "flat" | "new", count: number, prevCount: number): string {
  if (trend === "new") return "new this period";
  if (trend === "flat") return "unchanged";
  return `${trend} from ${prevCount}`;
}

const BLOCK_LABELS: Record<string, string> = {
  RETURN_PROMISE: "Return promise",
  ADVICE: "Advice",
  PERFORMANCE_CLAIM: "Performance claim",
  EMPTY: "Empty",
  TOO_LONG: "Too long",
  JUDGE: "LLM judge",
  UNKNOWN: "Other",
};

export const blockReasonLabel = (code: string): string => BLOCK_LABELS[code] ?? "Other";

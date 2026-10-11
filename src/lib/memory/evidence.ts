import type { Evidence } from "./rules";

/** Evidence is stored as JSON: [{ sourceRef, summary, observedAt (ISO), via? }]. These two functions are the only place it is (de)serialised. */
export function serializeEvidence(evidence: readonly Evidence[]): { sourceRef: string; summary: string; observedAt: string; via?: string }[] {
  return evidence.map((e) => ({ sourceRef: e.sourceRef, summary: e.summary, observedAt: e.observedAt.toISOString(), ...(e.via ? { via: e.via } : {}) }));
}

export function parseEvidence(json: unknown): Evidence[] {
  if (!Array.isArray(json)) return [];
  const out: Evidence[] = [];
  for (const raw of json) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.sourceRef !== "string" || typeof r.summary !== "string") continue;
    const at = typeof r.observedAt === "string" ? new Date(r.observedAt) : null;
    out.push({ sourceRef: r.sourceRef, summary: r.summary, observedAt: at && !Number.isNaN(at.getTime()) ? at : new Date(0), ...(typeof r.via === "string" ? { via: r.via } : {}) });
  }
  return out;
}

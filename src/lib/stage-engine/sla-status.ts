export type SlaStatus = "ON_TRACK" | "DUE_SOON" | "OVERDUE" | "NOT_APPLICABLE";

/** Computes SLA status from stage-entry time and the stage's configured SLA, on read (never persisted). */
export function computeSlaStatus(stageEnteredAt: Date, slaHours: number, now: Date = new Date()): SlaStatus {
  if (slaHours <= 0) return "NOT_APPLICABLE";
  const elapsedHours = (now.getTime() - stageEnteredAt.getTime()) / (1000 * 60 * 60);
  const ratio = elapsedHours / slaHours;
  if (ratio >= 1) return "OVERDUE";
  if (ratio >= 0.75) return "DUE_SOON";
  return "ON_TRACK";
}

export function stageAgeHours(stageEnteredAt: Date, now: Date = new Date()): number {
  return (now.getTime() - stageEnteredAt.getTime()) / (1000 * 60 * 60);
}

/**
 * Most offline clients arrive via stakeholder Referral, where SLA pressure doesn't apply — callers
 * use this to short-circuit their own SLA status to "NOT_APPLICABLE" for these clients rather than
 * computing ON_TRACK/DUE_SOON/OVERDUE. leadSource is free-text and unvalidated, hence the
 * case-insensitive, trimmed compare.
 */
export function isReferralLeadSource(leadSource?: string | null): boolean {
  return (leadSource ?? "").trim().toLowerCase() === "referral";
}

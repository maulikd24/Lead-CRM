import type { Client, Stage, Document, KycRecord, FundingRecord, DealerIntroduction, Activity } from "@/generated/prisma/client";

export type CopilotClient = Client & {
  currentStage: Stage;
  documents: Document[];
  kycRecord: KycRecord | null;
  fundingRecord: FundingRecord | null;
  dealerIntroduction: DealerIntroduction | null;
  activities: Pick<Activity, "type" | "payload">[];
};

/** Mandatory documents still blocking KYC submission — mirrors the check in stage-engine/transitions.ts's submitForKyc. */
export function incompleteMandatoryDocuments(documents: Document[]): Document[] {
  return documents.filter((d) => d.mandatory && d.status !== "VERIFIED" && d.status !== "NOT_APPLICABLE");
}

/** True once recordRmContact has run — mirrors the same signal used in stage-action-card.tsx. */
export function hasContactRecord(activities: Pick<Activity, "type" | "payload">[]): boolean {
  return activities.some(
    (a) => a.type === "NOTE" && a.payload && typeof a.payload === "object" && "contactMethod" in (a.payload as Record<string, unknown>),
  );
}

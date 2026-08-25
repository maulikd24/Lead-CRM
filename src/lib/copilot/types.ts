import type { Client, Stage, Document, KycRecord, FundingRecord, DealerIntroduction } from "@/generated/prisma/client";

export type CopilotClient = Client & {
  currentStage: Stage;
  documents: Document[];
  kycRecord: KycRecord | null;
  fundingRecord: FundingRecord | null;
  dealerIntroduction: DealerIntroduction | null;
};

/** Mandatory documents still blocking KYC submission — mirrors the check in stage-engine/transitions.ts's submitForKyc. */
export function incompleteMandatoryDocuments(documents: Document[]): Document[] {
  return documents.filter((d) => d.mandatory && d.status !== "VERIFIED" && d.status !== "NOT_APPLICABLE");
}

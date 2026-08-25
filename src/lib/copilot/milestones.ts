import type { Stage } from "@/generated/prisma/client";
import type { CopilotClient } from "./types";
import { incompleteMandatoryDocuments } from "./types";

export type MilestoneStatus = "done" | "current" | "blocked" | "upcoming";

export type MilestoneItem = {
  stageName: string;
  sequence: number;
  status: MilestoneStatus;
  blockingReason?: string;
};

/** Read-only per-client summary of the 8-stage onboarding sequence: what's done, current, blocked, or upcoming. */
export function getMilestoneChecklist(client: CopilotClient, allStages: Stage[]): MilestoneItem[] {
  const currentSequence = client.currentStage.sequence;

  return [...allStages]
    .sort((a, b) => a.sequence - b.sequence)
    .map((stage) => {
      if (stage.sequence < currentSequence) {
        return { stageName: stage.name, sequence: stage.sequence, status: "done" as const };
      }
      if (stage.sequence > currentSequence) {
        return { stageName: stage.name, sequence: stage.sequence, status: "upcoming" as const };
      }

      let blockingReason: string | undefined;
      if (stage.name === "Documents Collected") {
        const incomplete = incompleteMandatoryDocuments(client.documents);
        if (incomplete.length > 0) {
          blockingReason = `${incomplete.length} mandatory document(s) not yet verified`;
        }
      } else if (stage.name === "Documents Submitted for KYC" && client.kycRecord?.status !== "APPROVED") {
        blockingReason = `KYC status: ${client.kycRecord?.status ?? "not submitted"}`;
      } else if (
        stage.name === "KYC Completed" &&
        (!client.fundingRecord || client.fundingRecord.status === "PENDING")
      ) {
        blockingReason = "Funding not yet started";
      } else if (
        stage.name === "Funds Added" &&
        (!client.dealerIntroduction || client.dealerIntroduction.status !== "COMPLETED")
      ) {
        blockingReason = `Dealer introduction: ${client.dealerIntroduction?.status ?? "not scheduled"}`;
      }

      return {
        stageName: stage.name,
        sequence: stage.sequence,
        status: blockingReason ? ("blocked" as const) : ("current" as const),
        blockingReason,
      };
    });
}

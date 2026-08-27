import type { Stage } from "@/generated/prisma/client";
import type { CopilotClient } from "./types";
import { incompleteMandatoryDocuments, hasContactRecord } from "./types";

export type MilestoneStatus = "done" | "current" | "blocked" | "upcoming";

export type MilestoneItem = {
  stageName: string;
  sequence: number;
  status: MilestoneStatus;
  blockingReason?: string;
};

/** Read-only per-client summary of the 5-stage onboarding sequence: what's done, current, blocked, or upcoming. */
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

      // Terminal stage but onboarding already marked complete — show it as done, not current.
      if (client.status === "COMPLETED") {
        return { stageName: stage.name, sequence: stage.sequence, status: "done" as const };
      }

      let blockingReason: string | undefined;
      if (stage.name === "New Lead") {
        if (!hasContactRecord(client.activities)) {
          blockingReason = "Client not yet contacted";
        } else {
          const incomplete = incompleteMandatoryDocuments(client.documents);
          if (incomplete.length > 0) {
            blockingReason = `${incomplete.length} mandatory document(s) not yet verified`;
          }
        }
      } else if (stage.name === "Submitted for KYC" && client.kycRecord?.status !== "APPROVED") {
        blockingReason = `KYC status: ${client.kycRecord?.status ?? "not submitted"}`;
      } else if (
        stage.name === "KYC completed" &&
        (!client.fundingRecord || client.fundingRecord.status === "PENDING")
      ) {
        blockingReason = "Funding not yet started";
      } else if (
        stage.name === "Pushed for funds" &&
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

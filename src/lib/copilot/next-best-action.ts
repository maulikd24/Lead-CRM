import type { CopilotClient } from "./types";
import { incompleteMandatoryDocuments } from "./types";

export type NbaKind =
  | "contact_client"
  | "collect_documents"
  | "submit_kyc"
  | "follow_up_kyc"
  | "resolve_kyc_issue"
  | "follow_up_funding"
  | "schedule_dealer_intro"
  | "follow_up_dealer_intro"
  | "no_action_needed";

export type TemplateCategory = "document_reminder" | "kyc_reminder" | "funding_reminder" | "dealer_reminder" | "welcome";

export type NextBestAction = {
  kind: NbaKind;
  label: string;
  detail: string;
  suggestedTemplateCategory: TemplateCategory | null;
};

/**
 * Read-only recommendation mirroring the exact gating rules in stage-engine/transitions.ts —
 * never mutates data, just explains what the stage engine would require next.
 */
export function getNextBestAction(client: CopilotClient): NextBestAction {
  const stageName = client.currentStage.name;

  if (stageName === "Lead Created") {
    return {
      kind: "contact_client",
      label: "Make first contact",
      detail: "This lead hasn't been contacted yet — record the RM's first outreach.",
      suggestedTemplateCategory: "welcome",
    };
  }

  if (stageName === "RM Reaches Out") {
    if (client.documents.length === 0) {
      return {
        kind: "collect_documents",
        label: "Start document collection",
        detail: "No document checklist has been started for this client yet.",
        suggestedTemplateCategory: "document_reminder",
      };
    }
    return {
      kind: "collect_documents",
      label: "Continue document collection",
      detail: "Document checklist started — keep following up until complete.",
      suggestedTemplateCategory: "document_reminder",
    };
  }

  if (stageName === "Documents Collected") {
    const incomplete = incompleteMandatoryDocuments(client.documents);
    if (incomplete.length > 0) {
      return {
        kind: "collect_documents",
        label: `${incomplete.length} mandatory document${incomplete.length > 1 ? "s" : ""} pending verification`,
        detail: `Still waiting on: ${incomplete.map((d) => d.documentType).join(", ")}.`,
        suggestedTemplateCategory: "document_reminder",
      };
    }
    return {
      kind: "submit_kyc",
      label: "Submit for KYC",
      detail: "All mandatory documents are verified — this client is ready to submit for KYC.",
      suggestedTemplateCategory: null,
    };
  }

  if (stageName === "Documents Submitted for KYC") {
    if (client.kycRecord?.status === "ADDITIONAL_INFO_REQUIRED" || client.kycRecord?.status === "REJECTED") {
      return {
        kind: "resolve_kyc_issue",
        label: client.kycRecord.status === "REJECTED" ? "Resolve KYC rejection" : "Collect additional KYC info",
        detail: client.kycRecord.rejectionReason ?? "KYC needs attention before it can proceed.",
        suggestedTemplateCategory: "kyc_reminder",
      };
    }
    return {
      kind: "follow_up_kyc",
      label: "Follow up on KYC",
      detail: "KYC submission is pending review — check in with the KYC team.",
      suggestedTemplateCategory: "kyc_reminder",
    };
  }

  if (stageName === "KYC Completed") {
    if (!client.fundingRecord || client.fundingRecord.status === "PENDING") {
      return {
        kind: "follow_up_funding",
        label: "Follow up on funding",
        detail: "KYC is complete but funding hasn't started — nudge the client to fund their account.",
        suggestedTemplateCategory: "funding_reminder",
      };
    }
    return {
      kind: "no_action_needed",
      label: "Waiting on funding status",
      detail: "Funding is in progress.",
      suggestedTemplateCategory: null,
    };
  }

  if (stageName === "Funds Added") {
    if (!client.dealerIntroduction || client.dealerIntroduction.status === "PENDING") {
      return {
        kind: "schedule_dealer_intro",
        label: "Schedule dealer introduction",
        detail: "Funds are in — schedule the client's introduction to their dealer.",
        suggestedTemplateCategory: "dealer_reminder",
      };
    }
    return {
      kind: "no_action_needed",
      label: "Dealer intro scheduled",
      detail: "Waiting for the scheduled dealer introduction.",
      suggestedTemplateCategory: null,
    };
  }

  if (stageName === "Introduced with Dealer") {
    if (client.dealerIntroduction?.status === "SCHEDULED") {
      return {
        kind: "follow_up_dealer_intro",
        label: "Confirm dealer introduction completed",
        detail: "Dealer introduction was scheduled — confirm it happened and mark it complete.",
        suggestedTemplateCategory: "dealer_reminder",
      };
    }
    return {
      kind: "no_action_needed",
      label: "Awaiting completion",
      detail: "Onboarding should complete automatically once all milestones are done.",
      suggestedTemplateCategory: null,
    };
  }

  return {
    kind: "no_action_needed",
    label: "Onboarding complete",
    detail: "No further action needed.",
    suggestedTemplateCategory: null,
  };
}

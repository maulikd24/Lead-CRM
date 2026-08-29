import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/activities/log-activity";
import { onEvent } from "@/lib/journeys/dispatch";
import { getStageByName } from "./stages";
import { getHeldDurationMs, effectiveStageEnteredAt } from "./held-duration";
import { syncNextAction } from "./next-action";
import { createTaskIfNotExists } from "./create-task-if-not-exists";
import type { KycStatus, FundingStatus, DealerIntroStatus, Role } from "@/generated/prisma/client";

const DEFAULT_DOCUMENT_TYPES = [
  { documentType: "PAN", mandatory: true },
  { documentType: "Address Proof", mandatory: true },
  { documentType: "Bank Proof", mandatory: true },
  { documentType: "Photograph", mandatory: true },
  { documentType: "Signature", mandatory: true },
  { documentType: "Income Proof", mandatory: false },
];

async function advanceStage(
  clientId: string,
  toStageId: string,
  actorId: string,
  reason?: string,
  auditAction: string = "stage_changed",
) {
  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    include: { currentStage: true },
  });
  const toStage = await prisma.stage.findUniqueOrThrow({ where: { id: toStageId } });

  const heldMs = await getHeldDurationMs(clientId, client.currentStageId, new Date());
  const effectiveEnteredAt = effectiveStageEnteredAt(client.stageEnteredAt, heldMs);
  const durationHours = (Date.now() - effectiveEnteredAt.getTime()) / (1000 * 60 * 60);
  const slaMet = durationHours <= client.currentStage.slaHours;

  await prisma.$transaction([
    prisma.stageHistory.create({
      data: { clientId, fromStageId: client.currentStageId, toStageId, changedById: actorId, reason, slaMet, durationHours },
    }),
    prisma.auditLog.create({
      data: {
        userId: actorId,
        entity: "Client",
        entityId: clientId,
        action: auditAction,
        oldValue: { stage: client.currentStage.name },
        newValue: { stage: toStage.name },
        reason,
      },
    }),
    prisma.client.update({
      where: { id: clientId },
      data: { currentStageId: toStageId, stageEnteredAt: new Date() },
    }),
    // Close superseded stage-engine follow-ups for the stage being left — the transition
    // function that calls advanceStage creates the next stage's task right after this returns.
    // Manual and journey-sourced tasks (source !== "stage-engine:*") are untouched.
    prisma.task.updateMany({
      where: { clientId, source: { startsWith: "stage-engine:" }, status: { in: ["PENDING", "OVERDUE"] } },
      data: { status: "CANCELLED" },
    }),
  ]);

  await logActivity({
    clientId,
    userId: actorId,
    type: "STAGE_CHANGE",
    payload: {
      message: `Stage changed to ${toStage.name}`,
      fromStage: client.currentStage.name,
      toStage: toStage.name,
    },
  });

  await onEvent("stage_changed", clientId);
  await syncNextAction(clientId);

  return toStage;
}

/** Called right after a Client row is created with currentStageId already set to "New Lead". */
export async function initializeClient(clientId: string, actorId: string) {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  const stage1 = await getStageByName("New Lead");

  await prisma.stageHistory.create({
    data: { clientId, fromStageId: null, toStageId: stage1.id, changedById: actorId, reason: "Client created" },
  });
  await prisma.auditLog.create({
    data: { userId: actorId, entity: "Client", entityId: clientId, action: "created", newValue: { stage: stage1.name } },
  });

  if (client.assignedToId) {
    await createTaskIfNotExists({
      clientId,
      assignedToId: client.assignedToId,
      title: "Contact Client",
      dueAt: new Date(Date.now() + stage1.slaHours * 60 * 60 * 1000),
      source: "stage-engine:contact",
    });
    await prisma.notification.create({
      data: { userId: client.assignedToId, type: "new_assignment", payload: { clientId, clientName: client.name } },
    });
  }

  await logActivity({ clientId, userId: actorId, type: "NOTE", payload: { message: "Client created" } });
  await onEvent("client_created", clientId);
}

/** Within "New Lead" — records the RM's first outreach; no stage transition. Notes mandatory for negative outcomes; next action mandatory for open-ended ones. */
export async function recordRmContact(
  clientId: string,
  input: {
    contactMethod: "Phone" | "WhatsApp" | "In-person" | "Email" | "Other";
    contactOutcome: "Connected" | "Call back requested" | "Interested" | "Not interested" | "Unreachable" | "Wrong number";
    notes?: string;
    nextAction?: string;
    nextActionDate?: Date;
  },
  actorId: string,
) {
  const requiresNotes = ["Not interested", "Unreachable", "Wrong number"];
  const requiresNextAction = ["Call back requested", "Interested"];
  if (requiresNotes.includes(input.contactOutcome) && !input.notes) {
    throw new Error(`Notes are required for outcome "${input.contactOutcome}"`);
  }
  if (requiresNextAction.includes(input.contactOutcome) && !input.nextAction) {
    throw new Error(`Next action is required for outcome "${input.contactOutcome}"`);
  }

  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });

  await logActivity({
    clientId,
    userId: actorId,
    type: "NOTE",
    payload: {
      message: `Contacted via ${input.contactMethod}: ${input.contactOutcome}${input.notes ? ` — ${input.notes}` : ""}`,
      contactMethod: input.contactMethod,
      contactOutcome: input.contactOutcome,
    },
  });

  // Recording contact fulfills the initial "Contact Client" task — close it so it
  // doesn't linger open alongside the follow-up task created below.
  await prisma.task.updateMany({
    where: { clientId, source: "stage-engine:contact", status: { in: ["PENDING", "OVERDUE"] } },
    data: { status: "DONE" },
  });

  if (input.nextAction && client.assignedToId) {
    await createTaskIfNotExists({
      clientId,
      assignedToId: client.assignedToId,
      title: input.nextAction,
      dueAt: input.nextActionDate ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
      source: "stage-engine:follow-up",
    });
  }

  await syncNextAction(clientId);
}

/** Within "New Lead" — seeds the default document checklist; no stage transition. */
export async function startDocumentCollection(clientId: string) {
  const existingCount = await prisma.document.count({ where: { clientId } });
  if (existingCount === 0) {
    await prisma.document.createMany({ data: DEFAULT_DOCUMENT_TYPES.map((d) => ({ clientId, ...d })) });
  }
}

/** Updates a single document's checklist status; notifies the RM on rejection. */
export async function updateDocumentStatus(
  documentId: string,
  input: { status: "PENDING" | "RECEIVED" | "VERIFIED" | "REJECTED" | "NOT_APPLICABLE"; rejectionReason?: string; remarks?: string },
  actorId: string,
) {
  const doc = await prisma.document.update({
    where: { id: documentId },
    data: {
      status: input.status,
      rejectionReason: input.rejectionReason,
      remarks: input.remarks,
      receivedAt: input.status === "RECEIVED" ? new Date() : undefined,
      verifiedAt: input.status === "VERIFIED" ? new Date() : undefined,
    },
  });

  await logActivity({
    clientId: doc.clientId,
    userId: actorId,
    type: "NOTE",
    payload: { message: `Document ${doc.documentType}: ${input.status}` },
  });

  if (input.status === "REJECTED") {
    const client = await prisma.client.findUniqueOrThrow({ where: { id: doc.clientId } });
    if (client.assignedToId) {
      await prisma.notification.create({
        data: {
          userId: client.assignedToId,
          type: "document_rejected",
          payload: { clientId: doc.clientId, clientName: client.name, documentType: doc.documentType, reason: input.rejectionReason },
        },
      });
    }
  }

  return doc;
}

/** New Lead -> Submitted for KYC. Blocks unless mandatory documents are verified (or a Manager/Admin override is passed). */
export async function submitForKyc(
  clientId: string,
  input: { submissionMethod?: string; kycReferenceNumber?: string; remarks?: string; override?: boolean },
  actorId: string,
  actorRole: Role,
) {
  const documents = await prisma.document.findMany({ where: { clientId, mandatory: true } });
  const incomplete = documents.filter((d) => d.status !== "VERIFIED" && d.status !== "NOT_APPLICABLE");
  const canOverride = actorRole === "MANAGER" || actorRole === "ADMIN";
  if (incomplete.length > 0 && !(input.override && canOverride)) {
    throw new Error(`Mandatory documents incomplete: ${incomplete.map((d) => d.documentType).join(", ")}`);
  }

  await prisma.kycRecord.upsert({
    where: { clientId },
    update: {
      submissionDate: new Date(),
      submissionMethod: input.submissionMethod,
      referenceNumber: input.kycReferenceNumber,
      submittedBy: actorId,
      remarks: input.remarks,
      status: "PENDING",
    },
    create: {
      clientId,
      submissionDate: new Date(),
      submissionMethod: input.submissionMethod,
      referenceNumber: input.kycReferenceNumber,
      submittedBy: actorId,
      remarks: input.remarks,
      status: "PENDING",
    },
  });

  const stage2 = await getStageByName("Submitted for KYC");
  await advanceStage(clientId, stage2.id, actorId);

  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  if (client.assignedToId) {
    await createTaskIfNotExists({
      clientId,
      assignedToId: client.assignedToId,
      title: "Follow up with KYC Team",
      dueAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      source: "stage-engine:kyc-followup",
    });
  }
}

/** Submitted for KYC -> KYC completed only on APPROVED; stays put with a task for REJECTED / ADDITIONAL_INFO_REQUIRED. */
export async function completeKyc(
  clientId: string,
  input: { status: KycStatus; referenceNumber?: string; rejectionReason?: string; remarks?: string },
  actorId: string,
) {
  if (input.status === "REJECTED" && !input.rejectionReason) {
    throw new Error("A rejection reason is required when KYC is rejected");
  }

  await prisma.kycRecord.update({
    where: { clientId },
    data: {
      status: input.status,
      completionDate: new Date(),
      referenceNumber: input.referenceNumber,
      rejectionReason: input.rejectionReason,
      remarks: input.remarks,
    },
  });

  await logActivity({ clientId, userId: actorId, type: "NOTE", payload: { message: `KYC ${input.status}` } });

  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });

  if (input.status === "ADDITIONAL_INFO_REQUIRED") {
    if (client.assignedToId) {
      await createTaskIfNotExists({
        clientId,
        assignedToId: client.assignedToId,
        title: "Collect additional KYC information",
        dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        source: "stage-engine:kyc-info-required",
      });
      await prisma.notification.create({
        data: { userId: client.assignedToId, type: "kyc_update", payload: { clientId, clientName: client.name, message: "Additional KYC information required" } },
      });
    }
    return;
  }

  if (input.status === "REJECTED") {
    if (client.assignedToId) {
      await prisma.notification.create({
        data: { userId: client.assignedToId, type: "kyc_update", payload: { clientId, clientName: client.name, message: `KYC rejected: ${input.rejectionReason}` } },
      });
    }
    return;
  }

  const stage3 = await getStageByName("KYC completed");
  await advanceStage(clientId, stage3.id, actorId);

  if (client.assignedToId) {
    await createTaskIfNotExists({
      clientId,
      assignedToId: client.assignedToId,
      title: "Follow up for Funding",
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      source: "stage-engine:funding-followup",
    });
    await prisma.notification.create({
      data: { userId: client.assignedToId, type: "funding_pending", payload: { clientId, clientName: client.name } },
    });
  }

  await checkCompletion(clientId, actorId);
}

/** KYC completed -> Pushed for funds, only on a qualifying (Partially/Fully Funded) status. */
export async function updateFunding(
  clientId: string,
  input: {
    status: FundingStatus;
    amount?: number;
    fundingDate?: Date;
    fundingMethod?: string;
    referenceNumber?: string;
    remarks?: string;
  },
  actorId: string,
) {
  await prisma.fundingRecord.upsert({
    where: { clientId },
    update: { ...input, fundingDate: input.fundingDate ?? new Date() },
    create: { ...input, clientId, fundingDate: input.fundingDate ?? new Date() },
  });

  await logActivity({ clientId, userId: actorId, type: "NOTE", payload: { message: `Funding status: ${input.status}` } });

  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  const qualifies = input.status === "PARTIALLY_FUNDED" || input.status === "FULLY_FUNDED";

  if (!qualifies) {
    if (client.assignedToId) {
      await prisma.notification.create({
        data: { userId: client.assignedToId, type: "funding_pending", payload: { clientId, clientName: client.name, message: `Funding status: ${input.status}` } },
      });
    }
    return;
  }

  const stage4 = await getStageByName("Pushed for funds");
  if (client.currentStageId !== stage4.id) {
    await advanceStage(clientId, stage4.id, actorId);
  }

  if (client.assignedToId) {
    await createTaskIfNotExists({
      clientId,
      assignedToId: client.assignedToId,
      title: "Schedule Dealer Introduction",
      dueAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      source: "stage-engine:dealer-intro",
    });
  }

  await checkCompletion(clientId, actorId);
}

/** Pushed for funds -> Introduction with Dealer. Requires dealer details before advancing. */
export async function recordDealerIntroduction(
  clientId: string,
  input: {
    dealerId?: string;
    dealerName?: string;
    introductionMethod?: string;
    status: DealerIntroStatus;
    scheduledDate?: Date;
    remarks?: string;
  },
  actorId: string,
) {
  if (!input.dealerName) {
    throw new Error("Dealer name is required before recording a dealer introduction");
  }

  await prisma.dealerIntroduction.upsert({
    where: { clientId },
    update: { ...input, completedDate: input.status === "COMPLETED" ? new Date() : undefined },
    create: { ...input, clientId, completedDate: input.status === "COMPLETED" ? new Date() : undefined },
  });

  await logActivity({ clientId, userId: actorId, type: "NOTE", payload: { message: `Dealer introduction: ${input.status}` } });

  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  const stage5 = await getStageByName("Introduction with Dealer");
  if (client.currentStageId !== stage5.id) {
    await advanceStage(clientId, stage5.id, actorId);
  }

  if (input.status !== "COMPLETED" && client.assignedToId) {
    await prisma.notification.create({
      data: {
        userId: client.assignedToId,
        type: "dealer_intro_pending",
        payload: { clientId, clientName: client.name, message: `Dealer introduction ${input.status.toLowerCase()}` },
      },
    });
  }

  await checkCompletion(clientId, actorId);
}

/**
 * Automatic once KYC + Funding + Dealer Intro are all in a qualifying state. There is no
 * terminal stage anymore — the client stays on "Introduction with Dealer" and this just
 * flips Client.status to COMPLETED.
 */
export async function checkCompletion(clientId: string, actorId: string) {
  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    include: { kycRecord: true, fundingRecord: true, dealerIntroduction: true },
  });

  const kycDone = client.kycRecord?.status === "APPROVED";
  const fundsDone =
    client.fundingRecord?.status === "PARTIALLY_FUNDED" || client.fundingRecord?.status === "FULLY_FUNDED";
  const dealerDone = client.dealerIntroduction?.status === "COMPLETED";

  if (!(kycDone && fundsDone && dealerDone) || client.status === "COMPLETED") return;

  const durationDays = Math.round((Date.now() - client.createdAt.getTime()) / (1000 * 60 * 60 * 24));

  await prisma.client.update({
    where: { id: clientId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  await prisma.auditLog.create({
    data: {
      userId: actorId,
      entity: "Client",
      entityId: clientId,
      action: "auto_completed",
      oldValue: { status: "ACTIVE" },
      newValue: { status: "COMPLETED" },
      reason: "Automatic completion",
    },
  });
  await logActivity({
    clientId,
    type: "STAGE_CHANGE",
    payload: { message: "Onboarding completed", durationDays },
  });
}

/** Manager/Admin-only: move a client to any stage with a mandatory reason (bypasses sequential gating). */
export async function correctStage(clientId: string, toStageId: string, reason: string, actorId: string) {
  if (!reason) throw new Error("A reason is required for a manual stage correction");
  return advanceStage(clientId, toStageId, actorId, reason, "stage_corrected");
}

export async function putOnHold(
  clientId: string,
  input: { reason: string; expectedResumeDate?: Date; notes?: string },
  actorId: string,
) {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });

  await prisma.exception.create({
    data: {
      clientId,
      stageId: client.currentStageId,
      reason: input.reason,
      notes: input.notes,
      expectedResumeDate: input.expectedResumeDate,
      status: "OPEN",
    },
  });

  await prisma.client.update({ where: { id: clientId }, data: { status: "ON_HOLD" } });

  await prisma.auditLog.create({
    data: { userId: actorId, entity: "Client", entityId: clientId, action: "hold_started", newValue: { reason: input.reason }, reason: input.reason },
  });

  await logActivity({ clientId, userId: actorId, type: "NOTE", payload: { message: `Put on hold: ${input.reason}` } });

  if (client.assignedToId) {
    await prisma.notification.create({
      data: { userId: client.assignedToId, type: "hold_started", payload: { clientId, clientName: client.name, reason: input.reason } },
    });
  }
}

export async function resumeFromHold(clientId: string, actorId: string) {
  const openException = await prisma.exception.findFirst({
    where: { clientId, status: "OPEN" },
    orderBy: { createdAt: "desc" },
  });
  if (openException) {
    await prisma.exception.update({ where: { id: openException.id }, data: { status: "RESOLVED", resolvedAt: new Date() } });
  }

  await prisma.client.update({ where: { id: clientId }, data: { status: "ACTIVE" } });

  await prisma.auditLog.create({ data: { userId: actorId, entity: "Client", entityId: clientId, action: "hold_resolved" } });
  await logActivity({ clientId, userId: actorId, type: "NOTE", payload: { message: "Resumed from hold" } });
}

export async function markNotProceeding(clientId: string, input: { reason: string; notes?: string }, actorId: string) {
  await prisma.client.update({ where: { id: clientId }, data: { status: "NOT_PROCEEDING" } });
  await prisma.auditLog.create({
    data: { userId: actorId, entity: "Client", entityId: clientId, action: "marked_not_proceeding", newValue: { reason: input.reason }, reason: input.reason },
  });
  await logActivity({
    clientId,
    userId: actorId,
    type: "NOTE",
    payload: { message: `Marked not proceeding: ${input.reason}${input.notes ? ` — ${input.notes}` : ""}` },
  });
}

/** Manager/Admin only. */
export async function reopenClient(clientId: string, input: { reason: string }, actorId: string) {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });

  await prisma.client.update({ where: { id: clientId }, data: { status: "ACTIVE" } });
  await prisma.auditLog.create({
    data: { userId: actorId, entity: "Client", entityId: clientId, action: "reopened", reason: input.reason },
  });
  await logActivity({ clientId, userId: actorId, type: "NOTE", payload: { message: `Reopened: ${input.reason}` } });

  if (client.assignedToId) {
    await prisma.notification.create({
      data: { userId: client.assignedToId, type: "client_reopened", payload: { clientId, clientName: client.name, reason: input.reason } },
    });
  }
}

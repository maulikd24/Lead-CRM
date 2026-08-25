"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireUser, requireRole } from "@/lib/auth/require-role";
import { logActivity } from "@/lib/activities/log-activity";
import { sendMessage } from "@/lib/messaging/send";
import { generateClientCode } from "@/lib/stage-engine/client-code";
import { getStageByName } from "@/lib/stage-engine/stages";
import {
  initializeClient,
  recordRmContact,
  startDocumentCollection,
  updateDocumentStatus,
  submitForKyc,
  completeKyc,
  updateFunding,
  recordDealerIntroduction,
  correctStage,
  putOnHold,
  resumeFromHold,
  markNotProceeding,
  reopenClient,
} from "@/lib/stage-engine/transitions";
import type {
  KycStatus,
  FundingStatus,
  DealerIntroStatus,
  DocumentStatus,
} from "@/generated/prisma/client";

const createClientSchema = z.object({
  name: z.string().min(1, "Name is required"),
  mobile: z.string().min(1, "Mobile is required"),
  email: z.string().email().optional().or(z.literal("")),
  city: z.string().optional().or(z.literal("")),
  state: z.string().optional().or(z.literal("")),
  clientType: z.string().optional().or(z.literal("")),
  leadSource: z.string().optional().or(z.literal("")),
  productInterest: z.string().optional().or(z.literal("")),
  existingBroker: z.string().optional().or(z.literal("")),
  tradingExperience: z.string().optional().or(z.literal("")),
  expectedInvestment: z.coerce.number().optional(),
  referralSource: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  assignedToId: z.string().optional().or(z.literal("")),
  allowDuplicate: z.coerce.boolean().optional(),
});

export async function checkDuplicateClientAction(mobile: string, email: string) {
  const existing = await prisma.client.findFirst({
    where: {
      status: { not: "NOT_PROCEEDING" },
      OR: [{ mobile }, email ? { email } : undefined].filter(Boolean) as object[],
    },
    select: { id: true, name: true, clientCode: true, mobile: true, email: true },
  });
  return existing;
}

export async function searchClientsForMergeAction(query: string, excludeId: string) {
  await requireRole(["ADMIN", "MANAGER"]);
  if (!query.trim()) return [];

  return prisma.client.findMany({
    where: {
      id: { not: excludeId },
      mergedIntoId: null,
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { mobile: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
        { clientCode: { contains: query, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, clientCode: true, mobile: true, email: true },
    take: 8,
  });
}

export async function createClientAction(formData: FormData) {
  const session = await requireUser();

  const parsed = createClientSchema.parse({
    name: formData.get("name"),
    mobile: formData.get("mobile"),
    email: formData.get("email"),
    city: formData.get("city"),
    state: formData.get("state"),
    clientType: formData.get("clientType"),
    leadSource: formData.get("leadSource"),
    productInterest: formData.get("productInterest"),
    existingBroker: formData.get("existingBroker"),
    tradingExperience: formData.get("tradingExperience"),
    expectedInvestment: formData.get("expectedInvestment") || undefined,
    referralSource: formData.get("referralSource"),
    notes: formData.get("notes"),
    priority: formData.get("priority") || undefined,
    assignedToId: formData.get("assignedToId"),
    allowDuplicate: formData.get("allowDuplicate") || undefined,
  });

  if (!parsed.allowDuplicate) {
    const duplicate = await checkDuplicateClientAction(parsed.mobile, parsed.email || "");
    if (duplicate) {
      return { duplicate };
    }
  }

  const [clientCode, stage1] = await Promise.all([generateClientCode(), getStageByName("Lead Created")]);

  const client = await prisma.client.create({
    data: {
      clientCode,
      name: parsed.name,
      mobile: parsed.mobile,
      email: parsed.email || null,
      city: parsed.city || null,
      state: parsed.state || null,
      clientType: parsed.clientType || null,
      leadSource: parsed.leadSource || "manual",
      productInterest: parsed.productInterest || null,
      existingBroker: parsed.existingBroker || null,
      tradingExperience: parsed.tradingExperience || null,
      expectedInvestment: parsed.expectedInvestment ?? null,
      referralSource: parsed.referralSource || null,
      notes: parsed.notes || null,
      priority: parsed.priority ?? "MEDIUM",
      assignedToId: parsed.assignedToId || session.user.id,
      currentStageId: stage1.id,
    },
  });

  await initializeClient(client.id, session.user.id);

  revalidatePath("/clients");
  return { client: { id: client.id, clientCode: client.clientCode, name: client.name } };
}

export async function reassignClientAction(clientId: string, assignedToId: string) {
  const session = await requireUser();

  await prisma.client.update({ where: { id: clientId }, data: { assignedToId } });

  const newOwner = await prisma.user.findUnique({ where: { id: assignedToId } });
  await logActivity({
    clientId,
    userId: session.user.id,
    type: "NOTE",
    payload: { message: `Reassigned to ${newOwner?.name ?? assignedToId}` },
  });

  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
}

export async function addClientNoteAction(clientId: string, note: string) {
  const session = await requireUser();

  await logActivity({ clientId, userId: session.user.id, type: "NOTE", payload: { message: note } });

  revalidatePath(`/clients/${clientId}`);
}

export async function sendClientMessageAction(
  clientId: string,
  channel: "whatsapp" | "sms",
  templateId: string,
  variables: Record<string, string>,
) {
  await requireUser();

  const message = await sendMessage({ clientId, channel, templateId, variables });

  revalidatePath(`/clients/${clientId}`);
  return message;
}

// --- Stage Engine wrapper actions -------------------------------------------------

function revalidateClient(clientId: string) {
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
}

export async function recordRmContactAction(
  clientId: string,
  input: {
    contactMethod: "Phone" | "WhatsApp" | "In-person" | "Email" | "Other";
    contactOutcome: "Connected" | "Call back requested" | "Interested" | "Not interested" | "Unreachable" | "Wrong number";
    notes?: string;
    nextAction?: string;
    nextActionDate?: string;
  },
) {
  const session = await requireUser();
  await recordRmContact(
    clientId,
    { ...input, nextActionDate: input.nextActionDate ? new Date(input.nextActionDate) : undefined },
    session.user.id,
  );
  revalidateClient(clientId);
}

export async function startDocumentCollectionAction(clientId: string) {
  const session = await requireUser();
  await startDocumentCollection(clientId, session.user.id);
  revalidateClient(clientId);
}

export async function updateDocumentStatusAction(
  documentId: string,
  input: { status: DocumentStatus; rejectionReason?: string; remarks?: string },
) {
  const session = await requireUser();
  const doc = await updateDocumentStatus(documentId, input, session.user.id);
  revalidateClient(doc.clientId);
}

export async function submitForKycAction(
  clientId: string,
  input: { submissionMethod?: string; kycReferenceNumber?: string; remarks?: string; override?: boolean },
) {
  const session = await requireUser();
  await submitForKyc(clientId, input, session.user.id, session.user.role);
  revalidateClient(clientId);
}

export async function completeKycAction(
  clientId: string,
  input: { status: KycStatus; referenceNumber?: string; rejectionReason?: string; remarks?: string },
) {
  const session = await requireUser();
  await completeKyc(clientId, input, session.user.id);
  revalidateClient(clientId);
}

export async function updateFundingAction(
  clientId: string,
  input: {
    status: FundingStatus;
    amount?: number;
    fundingDate?: string;
    fundingMethod?: string;
    referenceNumber?: string;
    remarks?: string;
  },
) {
  const session = await requireUser();
  await updateFunding(
    clientId,
    { ...input, fundingDate: input.fundingDate ? new Date(input.fundingDate) : undefined },
    session.user.id,
  );
  revalidateClient(clientId);
}

export async function recordDealerIntroductionAction(
  clientId: string,
  input: {
    dealerId?: string;
    dealerName?: string;
    introductionMethod?: string;
    status: DealerIntroStatus;
    scheduledDate?: string;
    remarks?: string;
  },
) {
  const session = await requireUser();
  await recordDealerIntroduction(
    clientId,
    { ...input, scheduledDate: input.scheduledDate ? new Date(input.scheduledDate) : undefined },
    session.user.id,
  );
  revalidateClient(clientId);
}

export async function correctStageAction(clientId: string, toStageId: string, reason: string) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  await correctStage(clientId, toStageId, reason, session.user.id);
  revalidateClient(clientId);
}

export async function putOnHoldAction(
  clientId: string,
  input: { reason: string; expectedResumeDate?: string; notes?: string },
) {
  const session = await requireUser();
  await putOnHold(
    clientId,
    { ...input, expectedResumeDate: input.expectedResumeDate ? new Date(input.expectedResumeDate) : undefined },
    session.user.id,
  );
  revalidateClient(clientId);
}

export async function resumeFromHoldAction(clientId: string) {
  const session = await requireUser();
  await resumeFromHold(clientId, session.user.id);
  revalidateClient(clientId);
}

export async function markNotProceedingAction(clientId: string, input: { reason: string; notes?: string }) {
  const session = await requireUser();
  await markNotProceeding(clientId, input, session.user.id);
  revalidateClient(clientId);
}

export async function reopenClientAction(clientId: string, input: { reason: string }) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  await reopenClient(clientId, input, session.user.id);
  revalidateClient(clientId);
}

// --- Merge -------------------------------------------------------------------------

export async function mergeClientsAction(primaryId: string, duplicateId: string) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (primaryId === duplicateId) throw new Error("Cannot merge a client into itself");

  await prisma.$transaction([
    prisma.document.updateMany({ where: { clientId: duplicateId }, data: { clientId: primaryId } }),
    prisma.task.updateMany({ where: { clientId: duplicateId }, data: { clientId: primaryId } }),
    prisma.activity.updateMany({ where: { clientId: duplicateId }, data: { clientId: primaryId } }),
    prisma.client.update({
      where: { id: duplicateId },
      data: { mergedIntoId: primaryId, status: "NOT_PROCEEDING" },
    }),
    prisma.auditLog.create({
      data: {
        userId: session.user.id,
        entity: "Client",
        entityId: duplicateId,
        action: "merged",
        newValue: { mergedIntoId: primaryId },
      },
    }),
  ]);

  revalidatePath("/clients");
  revalidatePath(`/clients/${primaryId}`);
}

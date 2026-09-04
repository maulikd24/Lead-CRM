"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireUser, requireRole } from "@/lib/auth/require-role";
import { logActivity } from "@/lib/activities/log-activity";
import { sendMessage } from "@/lib/messaging/send";
import { generateClientCode } from "@/lib/stage-engine/client-code";
import { getStageByName } from "@/lib/stage-engine/stages";
import { normalizePhone, normalizeEmail, normalizePan, PAN_REGEX } from "@/lib/utils/normalize-contact";
import { pickAssignee } from "@/lib/assignment/routing-engine";
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
import { Prisma } from "@/generated/prisma/client";
import type { KycStatus, FundingStatus, DealerIntroStatus, DocumentStatus } from "@/generated/prisma/client";

const createClientSchema = z.object({
  name: z.string().min(1, "Name is required"),
  mobile: z.string().min(1, "Mobile is required"),
  email: z.string().email().optional().or(z.literal("")),
  pan: z
    .string()
    .transform((v) => v.trim().toUpperCase())
    .refine((v) => PAN_REGEX.test(v), "Invalid PAN format (expected e.g. ABCDE1234F)"),
  ckycRef: z.string().optional().or(z.literal("")),
  region: z.string().optional().or(z.literal("")),
  preferredLanguage: z.string().optional().or(z.literal("")),
  clientType: z.string().optional().or(z.literal("")),
  leadSource: z.string().optional().or(z.literal("")),
  referralSource: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  assignedToId: z.string().optional().or(z.literal("")),
  allowDuplicate: z.coerce.boolean().optional(),
});

type DuplicateInfo = {
  id: string;
  name: string;
  clientCode: string;
  mobile: string;
  email: string | null;
  pan: string | null;
};

export type DuplicateCheckResult = {
  duplicate: DuplicateInfo | null;
  reason: "pan" | "ckycRef" | "mobile_or_email" | null;
  blocking: boolean;
};

const DUPLICATE_SELECT = { id: true, name: true, clientCode: true, mobile: true, email: true, pan: true } as const;

export async function checkDuplicateClientAction(
  mobile: string,
  email: string,
  pan: string,
  ckycRef?: string,
): Promise<DuplicateCheckResult> {
  // PAN and CKYC ref are unique government/regulatory identifiers — an exact match is a hard
  // block (merge, don't create), unlike the overridable mobile/email soft-duplicate check below.
  const normalizedPan = normalizePan(pan);
  const panMatch = await prisma.client.findFirst({
    where: { pan: normalizedPan, mergedIntoId: null },
    select: DUPLICATE_SELECT,
  });
  if (panMatch) return { duplicate: panMatch, reason: "pan", blocking: true };

  const trimmedCkycRef = ckycRef?.trim();
  if (trimmedCkycRef) {
    const ckycMatch = await prisma.client.findFirst({
      where: { ckycRef: trimmedCkycRef, mergedIntoId: null },
      select: DUPLICATE_SELECT,
    });
    if (ckycMatch) return { duplicate: ckycMatch, reason: "ckycRef", blocking: true };
  }

  // Fast path: exact match (covers the common case with a single indexed-ish query).
  const exact = await prisma.client.findFirst({
    where: {
      status: { not: "NOT_PROCEEDING" },
      mergedIntoId: null,
      OR: [{ mobile }, email ? { email } : undefined].filter(Boolean) as object[],
    },
    select: DUPLICATE_SELECT,
  });
  if (exact) return { duplicate: exact, reason: "mobile_or_email", blocking: false };

  // Slow path: normalized comparison catches formatting differences (country code,
  // spacing, dashes, email case) exact-match misses. Acceptable at this CRM's scale;
  // a normalized shadow column + index would be the next step if the client base grows a lot.
  const normMobile = normalizePhone(mobile);
  const normEmail = email ? normalizeEmail(email) : null;
  if (!normMobile && !normEmail) return { duplicate: null, reason: null, blocking: false };

  const candidates = await prisma.client.findMany({
    where: { status: { not: "NOT_PROCEEDING" }, mergedIntoId: null },
    select: DUPLICATE_SELECT,
  });

  const normMatch =
    candidates.find(
      (c) =>
        (normMobile && normalizePhone(c.mobile) === normMobile) ||
        (normEmail && c.email && normalizeEmail(c.email) === normEmail),
    ) ?? null;

  return { duplicate: normMatch, reason: normMatch ? "mobile_or_email" : null, blocking: false };
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
    pan: formData.get("pan"),
    ckycRef: formData.get("ckycRef"),
    region: formData.get("region"),
    preferredLanguage: formData.get("preferredLanguage"),
    clientType: formData.get("clientType"),
    leadSource: formData.get("leadSource"),
    referralSource: formData.get("referralSource"),
    notes: formData.get("notes"),
    assignedToId: formData.get("assignedToId"),
    allowDuplicate: formData.get("allowDuplicate") || undefined,
  });

  const dupCheck = await checkDuplicateClientAction(
    parsed.mobile,
    parsed.email || "",
    parsed.pan,
    parsed.ckycRef,
  );
  // PAN/CKYC matches are a hard block — no override, unlike the mobile/email soft duplicate below.
  if (dupCheck.blocking) return { status: "duplicate" as const, ...dupCheck };
  if (!parsed.allowDuplicate && dupCheck.duplicate) return { status: "duplicate" as const, ...dupCheck };

  const [clientCode, stage1] = await Promise.all([generateClientCode(), getStageByName("New Lead")]);

  let assignedToId = parsed.assignedToId || null;
  let autoAssignFailed = false;
  if (!assignedToId) {
    // New leads auto-assign through the routing engine by default; the creator can still
    // override by picking an RM explicitly in the dialog.
    const pick = await pickAssignee({
      clientType: parsed.clientType || null,
      expectedInvestment: null,
      region: parsed.region || null,
      preferredLanguage: parsed.preferredLanguage || null,
    });
    if (pick.assignedToId) {
      assignedToId = pick.assignedToId;
    } else {
      autoAssignFailed = true;
    }
  }

  let client;
  try {
    client = await prisma.client.create({
      data: {
        clientCode,
        name: parsed.name,
        mobile: parsed.mobile,
        email: parsed.email || null,
        pan: normalizePan(parsed.pan),
        ckycRef: parsed.ckycRef || null,
        region: parsed.region || null,
        preferredLanguage: parsed.preferredLanguage || null,
        clientType: parsed.clientType || null,
        leadSource: parsed.leadSource || "manual",
        referralSource: parsed.referralSource || null,
        notes: parsed.notes || null,
        // Falls back to the creating user only when auto-assignment couldn't find an eligible RM.
        assignedToId: assignedToId || (autoAssignFailed ? null : session.user.id),
        currentStageId: stage1.id,
      },
    });
  } catch (error) {
    // The check-then-create above isn't atomic — a concurrent submit with the same PAN/CKYC ref
    // can still slip past it and hit the DB's unique constraint. Re-resolve to the same
    // hard-block response the pre-check would have given.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const recheck = await checkDuplicateClientAction(parsed.mobile, parsed.email || "", parsed.pan, parsed.ckycRef);
      if (recheck.duplicate) return { status: "duplicate" as const, ...recheck };
    }
    throw error;
  }

  if (autoAssignFailed) {
    const managers = await prisma.user.findMany({
      where: { isActive: true, role: { in: ["MANAGER", "ADMIN"] } },
      select: { id: true },
    });
    await Promise.all([
      prisma.auditLog.create({
        data: {
          userId: session.user.id,
          entity: "Client",
          entityId: client.id,
          action: "auto_assign_failed",
          reason: "No eligible RM found (availability/capacity/region/language/HNI constraints)",
        },
      }),
      logActivity({
        clientId: client.id,
        userId: session.user.id,
        type: "NOTE",
        payload: { message: "Auto-assignment failed — no eligible RM found; left unassigned and managers notified." },
      }),
      ...managers.map((m) =>
        prisma.notification.create({
          data: {
            userId: m.id,
            type: "new_assignment",
            payload: { clientId: client.id, clientName: client.name, reason: "no_eligible_rm" },
          },
        }),
      ),
    ]);
  }

  await initializeClient(client.id, session.user.id);

  revalidatePath("/clients");
  return {
    status: "created" as const,
    client: { id: client.id, clientCode: client.clientCode, name: client.name },
    unassigned: autoAssignFailed,
  };
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
  revalidatePath("/copilot");
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
  await requireUser();
  await startDocumentCollection(clientId);
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
    bankAccountVerified: boolean;
    bankAccountLast4?: string;
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

  const [primaryKyc, duplicateKyc, primaryFunding, duplicateFunding, primaryDealer, duplicateDealer, duplicateClient] =
    await Promise.all([
      prisma.kycRecord.findUnique({ where: { clientId: primaryId } }),
      prisma.kycRecord.findUnique({ where: { clientId: duplicateId } }),
      prisma.fundingRecord.findUnique({ where: { clientId: primaryId } }),
      prisma.fundingRecord.findUnique({ where: { clientId: duplicateId } }),
      prisma.dealerIntroduction.findUnique({ where: { clientId: primaryId } }),
      prisma.dealerIntroduction.findUnique({ where: { clientId: duplicateId } }),
      prisma.client.findUnique({ where: { id: duplicateId }, select: { name: true, clientCode: true } }),
    ]);

  const conflicts: string[] = [];
  const operations: Prisma.PrismaPromise<unknown>[] = [
    prisma.document.updateMany({ where: { clientId: duplicateId }, data: { clientId: primaryId } }),
    prisma.task.updateMany({ where: { clientId: duplicateId }, data: { clientId: primaryId } }),
    prisma.activity.updateMany({ where: { clientId: duplicateId }, data: { clientId: primaryId } }),
    prisma.stageHistory.updateMany({ where: { clientId: duplicateId }, data: { clientId: primaryId } }),
    prisma.exception.updateMany({ where: { clientId: duplicateId }, data: { clientId: primaryId } }),
  ];

  if (duplicateKyc) {
    if (!primaryKyc) {
      operations.push(prisma.kycRecord.update({ where: { clientId: duplicateId }, data: { clientId: primaryId } }));
    } else {
      conflicts.push("KycRecord");
    }
  }
  if (duplicateFunding) {
    if (!primaryFunding) {
      operations.push(prisma.fundingRecord.update({ where: { clientId: duplicateId }, data: { clientId: primaryId } }));
    } else {
      conflicts.push("FundingRecord");
    }
  }
  if (duplicateDealer) {
    if (!primaryDealer) {
      operations.push(prisma.dealerIntroduction.update({ where: { clientId: duplicateId }, data: { clientId: primaryId } }));
    } else {
      conflicts.push("DealerIntroduction");
    }
  }

  operations.push(
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
        newValue: { mergedIntoId: primaryId, unresolvedConflicts: conflicts },
      },
    }),
    // Pushed directly (not via the logActivity() helper) so it stays a PrismaPromise batched
    // into this $transaction — an async wrapper would return a plain Promise instead.
    prisma.activity.create({
      data: {
        clientId: primaryId,
        userId: session.user.id,
        type: "NOTE",
        payload: {
          message: duplicateClient
            ? `Merged duplicate client ${duplicateClient.name} (${duplicateClient.clientCode}) into this record${conflicts.length ? ` (unresolved: ${conflicts.join(", ")})` : ""}`
            : `Merged a duplicate client into this record${conflicts.length ? ` (unresolved: ${conflicts.join(", ")})` : ""}`,
        },
      },
    }),
  );

  await prisma.$transaction(operations);

  revalidatePath("/clients");
  revalidatePath(`/clients/${primaryId}`);
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireUser, requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { logActivity } from "@/lib/activities/log-activity";
import { sendMessage } from "@/lib/messaging/send";
import { generateClientCode } from "@/lib/stage-engine/client-code";
import { getStageByName } from "@/lib/stage-engine/stages";
import { syncNextAction } from "@/lib/stage-engine/next-action";
import { normalizePhone, normalizeEmail, normalizePan, PAN_REGEX } from "@/lib/utils/normalize-contact";
import { pickAssignee } from "@/lib/assignment/routing-engine";
import { can } from "@/lib/policy/can";
import { mergeClientRecords, MergeBlockedError, type MergeSummary } from "@/lib/clients/merge";
import { requestApproval } from "@/lib/policy/approvals/service";
import {
  initializeClient,
  recordRmContact,
  startDocumentCollection,
  updateDocumentStatus,
  submitForKyc,
  completeKyc,
  updateFunding,
  recordDealerIntroduction,
  markOnboardingCompleted,
  correctStage,
  putOnHold,
  resumeFromHold,
  markNotProceeding,
  reopenClient,
  verifyAllDocuments,
} from "@/lib/stage-engine/transitions";
import { Prisma } from "@/generated/prisma/client";
import type { Client, KycStatus, FundingStatus, DealerIntroStatus, DocumentStatus, OperatingInstruction, ActivityType, Role, Priority } from "@/generated/prisma/client";
import { addHolderCore, type HolderInput } from "./holder-actions";

const createClientSchema = z.object({
  name: z.string().min(1, "Name is required"),
  mobile: z.string().min(1, "Mobile is required"),
  email: z.string().email().optional().or(z.literal("")),
  pan: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v.trim().toUpperCase() : undefined))
    .refine((v) => !v || PAN_REGEX.test(v), "Invalid PAN format (expected e.g. ABCDE1234F)"),
  ckycRef: z.string().optional().or(z.literal("")),
  region: z.string().optional().or(z.literal("")),
  preferredLanguage: z.string().optional().or(z.literal("")),
  clientType: z.string().optional().or(z.literal("")),
  investmentCategory: z.string().optional().or(z.literal("")),
  leadSource: z.string().optional().or(z.literal("")),
  referralSource: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  assignedToId: z.string().optional().or(z.literal("")),
  allowDuplicate: z.coerce.boolean().optional(),
  city: z.string().optional().or(z.literal("")),
  state: z.string().optional().or(z.literal("")),
  productInterest: z.string().optional().or(z.literal("")),
  existingBroker: z.string().optional().or(z.literal("")),
  tradingExperience: z.string().optional().or(z.literal("")),
});

type DuplicateInfo = {
  id: string;
  name: string;
  clientCode: string;
  mobile: string | null;
  email: string | null;
  pan: string | null;
};

export type DuplicateCheckResult = {
  duplicate: DuplicateInfo | null;
  reason: "pan" | "ckycRef" | "mobile" | "email" | null;
  blocking: boolean;
};

const DUPLICATE_SELECT = { id: true, name: true, clientCode: true, mobile: true, email: true, pan: true } as const;

export async function checkDuplicateClientAction(
  mobile: string | undefined,
  email: string,
  pan?: string,
  ckycRef?: string,
  excludeId?: string,
): Promise<DuplicateCheckResult> {
  const notSelf = excludeId ? { id: { not: excludeId } } : {};

  // PAN and CKYC ref are unique government/regulatory identifiers — an exact match is a hard
  // block (merge, don't create/edit), unlike the overridable email soft-duplicate check below.
  // PAN is optional at creation, so skip this check entirely rather than query on an empty string.
  const trimmedPan = pan?.trim();
  if (trimmedPan) {
    const normalizedPan = normalizePan(trimmedPan);
    const panMatch = await prisma.client.findFirst({
      where: { pan: normalizedPan, mergedIntoId: null, isDeleted: false, ...notSelf },
      select: DUPLICATE_SELECT,
    });
    if (panMatch) return { duplicate: panMatch, reason: "pan", blocking: true };
  }

  const trimmedCkycRef = ckycRef?.trim();
  if (trimmedCkycRef) {
    const ckycMatch = await prisma.client.findFirst({
      where: { ckycRef: trimmedCkycRef, mergedIntoId: null, isDeleted: false, ...notSelf },
      select: DUPLICATE_SELECT,
    });
    if (ckycMatch) return { duplicate: ckycMatch, reason: "ckycRef", blocking: true };
  }

  // Mobile is a hard block too, same tier as PAN/CKYC — no override. Checked both exact and
  // normalized (country code/spacing/dashes) since it's not a DB-unique column (see note at the
  // call site in checkDuplicateClientAction's callers about why no @unique constraint was added).
  // Mobile is optional (an inbound Email/Live Chat contact may have none at all) — skip this
  // block entirely rather than query on it: a bare `where: { mobile: undefined }` wouldn't filter
  // at all (Prisma strips undefined values from a where clause), which would otherwise match the
  // first arbitrary client in the table and misreport a duplicate.
  const trimmedMobile = mobile?.trim();
  if (trimmedMobile) {
    const mobileExact = await prisma.client.findFirst({
      where: { mobile: trimmedMobile, mergedIntoId: null, isDeleted: false, ...notSelf },
      select: DUPLICATE_SELECT,
    });
    if (mobileExact) return { duplicate: mobileExact, reason: "mobile", blocking: true };

    const normMobile = normalizePhone(trimmedMobile);
    if (normMobile) {
      const mobileCandidates = await prisma.client.findMany({
        where: { mergedIntoId: null, isDeleted: false, ...notSelf },
        select: DUPLICATE_SELECT,
      });
      const mobileNormMatch = mobileCandidates.find((c) => c.mobile && normalizePhone(c.mobile) === normMobile);
      if (mobileNormMatch) return { duplicate: mobileNormMatch, reason: "mobile", blocking: true };
    }
  }

  // Email stays a soft, overridable warning.
  if (!email) return { duplicate: null, reason: null, blocking: false };

  const emailExact = await prisma.client.findFirst({
    where: { status: { not: "NOT_PROCEEDING" }, mergedIntoId: null, isDeleted: false, email, ...notSelf },
    select: DUPLICATE_SELECT,
  });
  if (emailExact) return { duplicate: emailExact, reason: "email", blocking: false };

  // Slow path: normalized comparison catches email-case formatting differences exact-match
  // misses. Acceptable at this CRM's scale; a normalized shadow column + index would be the
  // next step if the client base grows a lot.
  const normEmail = normalizeEmail(email);
  const emailCandidates = await prisma.client.findMany({
    where: { status: { not: "NOT_PROCEEDING" }, mergedIntoId: null, isDeleted: false, ...notSelf },
    select: DUPLICATE_SELECT,
  });
  const emailNormMatch = emailCandidates.find((c) => c.email && normalizeEmail(c.email) === normEmail) ?? null;

  return { duplicate: emailNormMatch, reason: emailNormMatch ? "email" : null, blocking: false };
}

export async function searchClientsForMergeAction(query: string, excludeId: string) {
  await requireRole(["ADMIN", "MANAGER", "RM"]);
  if (!query.trim()) return [];

  return prisma.client.findMany({
    where: {
      id: { not: excludeId },
      mergedIntoId: null,
      isDeleted: false,
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

export type CreateClientInput = {
  name: string;
  // Optional: an inbound Email/Live Chat contact (via resolveInboundClient()) may have no phone —
  // the manual "New Client" dialog and CSV bulk import both still require it at their own
  // form/row-validation layer, so this widening only affects the webhook-driven caller.
  mobile?: string;
  email?: string;
  pan?: string;
  ckycRef?: string;
  region?: string;
  preferredLanguage?: string;
  clientType?: string;
  investmentCategory?: string;
  leadSource?: string;
  referralSource?: string;
  notes?: string;
  assignedToId?: string;
  allowDuplicate?: boolean;
  city?: string;
  state?: string;
  productInterest?: string;
  existingBroker?: string;
  tradingExperience?: string;
  holders?: HolderInput[];
  operatingInstruction?: OperatingInstruction;
  // Set by lead intake (ads / website forms) only — see src/lib/leads/ingest.ts.
  priority?: Priority;
  leadAttribution?: Prisma.InputJsonValue;
  customerCategory?: string;
  marketingConsentAt?: Date;
  marketingConsentText?: string;
};

export type CreateClientResult =
  | {
      status: "created";
      client: { id: string; clientCode: string; name: string };
      unassigned: boolean;
      unassignedReason: "no_eligible_rm" | "manual_mode" | null;
    }
  | ({ status: "duplicate" } & DuplicateCheckResult);

/**
 * The shared create path for both the single-client dialog and bulk CSV import — same
 * PAN-required validation, same PAN/CKYC hard-block vs. mobile/email soft-duplicate dedup, same
 * auto-assignment. Neither caller may bypass any of this.
 */
export async function createClientCore(input: CreateClientInput, actorUserId: string): Promise<CreateClientResult> {
  const dupCheck = await checkDuplicateClientAction(input.mobile, input.email || "", input.pan, input.ckycRef);
  // PAN/CKYC matches are a hard block — no override, unlike the mobile/email soft duplicate below.
  if (dupCheck.blocking) return { status: "duplicate" as const, ...dupCheck };
  if (!input.allowDuplicate && dupCheck.duplicate) return { status: "duplicate" as const, ...dupCheck };

  const holders = input.holders ?? [];
  if (holders.length > 2) throw new Error("An account can have at most 3 total holders (First, Second, Third)");
  if (input.operatingInstruction === "EITHER_OR_SURVIVOR" && holders.length + 1 !== 2) {
    throw new Error("Either-or-Survivor requires exactly 2 total holders");
  }

  const [clientCode, stage1] = await Promise.all([generateClientCode(), getStageByName("New Lead")]);

  let assignedToId = input.assignedToId || null;
  let autoAssignFailed = false;
  let unassignedReason: "no_eligible_rm" | "manual_mode" = "no_eligible_rm";
  if (!assignedToId) {
    // New leads auto-assign through the routing engine by default; the creator can still
    // override by picking an RM explicitly.
    const pick = await pickAssignee({
      clientType: input.clientType || null,
      expectedInvestment: null,
      region: input.region || null,
      preferredLanguage: input.preferredLanguage || null,
    });
    if (pick.assignedToId === null) {
      autoAssignFailed = true;
      unassignedReason = pick.reason;
    } else {
      assignedToId = pick.assignedToId;
    }
  }

  let client;
  try {
    client = await prisma.client.create({
      data: {
        clientCode,
        name: input.name,
        mobile: input.mobile || null,
        email: input.email || null,
        pan: input.pan ? normalizePan(input.pan) : null,
        ckycRef: input.ckycRef || null,
        region: input.region || null,
        preferredLanguage: input.preferredLanguage || null,
        clientType: input.clientType || null,
        investmentCategory: input.investmentCategory || null,
        leadSource: input.leadSource || "manual",
        ...(input.priority ? { priority: input.priority } : {}),
        ...(input.leadAttribution !== undefined ? { leadAttribution: input.leadAttribution } : {}),
        customerCategory: input.customerCategory || null,
        marketingConsentAt: input.marketingConsentAt ?? null,
        marketingConsentText: input.marketingConsentText ?? null,
        referralSource: input.referralSource || null,
        notes: input.notes || null,
        city: input.city || null,
        state: input.state || null,
        productInterest: input.productInterest || null,
        existingBroker: input.existingBroker || null,
        tradingExperience: input.tradingExperience || null,
        // Falls back to the creating user only when auto-assignment couldn't find an eligible RM.
        assignedToId: assignedToId || (autoAssignFailed ? null : actorUserId),
        currentStageId: stage1.id,
        operatingInstruction: input.operatingInstruction || null,
      },
    });
  } catch (error) {
    // The check-then-create above isn't atomic — a concurrent submit with the same PAN/CKYC ref
    // can still slip past it and hit the DB's unique constraint. Re-resolve to the same
    // hard-block response the pre-check would have given.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const recheck = await checkDuplicateClientAction(input.mobile, input.email || "", input.pan, input.ckycRef);
      if (recheck.duplicate) return { status: "duplicate" as const, ...recheck };
    }
    throw error;
  }

  if (autoAssignFailed) {
    const manualMode = unassignedReason === "manual_mode";
    const managers = await prisma.user.findMany({
      where: { isActive: true, role: { in: ["MANAGER", "ADMIN"] } },
      select: { id: true },
    });
    await Promise.all([
      prisma.auditLog.create({
        data: {
          userId: actorUserId,
          entity: "Client",
          entityId: client.id,
          action: manualMode ? "auto_assign_skipped_manual" : "auto_assign_failed",
          reason: manualMode
            ? "Lead assignment is set to Manual — left unassigned"
            : "No eligible RM found (availability/capacity/region/language/HNI constraints)",
        },
      }),
      logActivity({
        clientId: client.id,
        userId: actorUserId,
        type: "NOTE",
        payload: {
          message: manualMode
            ? "Lead assignment is set to Manual — left unassigned and managers notified."
            : "Auto-assignment failed — no eligible RM found; left unassigned and managers notified.",
        },
      }),
      ...managers.map((m) =>
        prisma.notification.create({
          data: {
            userId: m.id,
            type: "unassigned_lead",
            payload: { clientId: client.id, clientName: client.name, reason: unassignedReason },
          },
        }),
      ),
    ]);
  }

  await initializeClient(client.id, actorUserId);

  for (const holder of holders) {
    await addHolderCore(client.id, holder, actorUserId);
  }

  revalidatePath("/clients");
  return {
    status: "created" as const,
    client: { id: client.id, clientCode: client.clientCode, name: client.name },
    unassigned: autoAssignFailed,
    unassignedReason: autoAssignFailed ? unassignedReason : null,
  };
}

export async function createClientAction(formData: FormData) {
  const session = await requireUser();

  // FormData.get() returns null (not undefined/"") for a field with no matching <input> at all —
  // e.g. city/state/productInterest/existingBroker/tradingExperience aren't in this dialog's form,
  // only reachable via CSV import. The schema's optional fields accept undefined/"" but not null,
  // so normalize every optional field's null to undefined before parsing.
  const parsed = createClientSchema.parse({
    name: formData.get("name"),
    mobile: formData.get("mobile"),
    email: formData.get("email") ?? undefined,
    pan: formData.get("pan") ?? undefined,
    ckycRef: formData.get("ckycRef") ?? undefined,
    region: formData.get("region") ?? undefined,
    preferredLanguage: formData.get("preferredLanguage") ?? undefined,
    clientType: formData.get("clientType") ?? undefined,
    investmentCategory: formData.get("investmentCategory") ?? undefined,
    leadSource: formData.get("leadSource") ?? undefined,
    referralSource: formData.get("referralSource") ?? undefined,
    notes: formData.get("notes") ?? undefined,
    assignedToId: formData.get("assignedToId") ?? undefined,
    allowDuplicate: formData.get("allowDuplicate") || undefined,
    city: formData.get("city") ?? undefined,
    state: formData.get("state") ?? undefined,
    productInterest: formData.get("productInterest") ?? undefined,
    existingBroker: formData.get("existingBroker") ?? undefined,
    tradingExperience: formData.get("tradingExperience") ?? undefined,
  });

  // A repeatable holder sub-form can't be expressed as plain named <input>s, so the dialog
  // serializes it into one hidden JSON field instead — addHolderCore validates each entry's shape.
  const holdersRaw = String(formData.get("holdersJson") || "[]");
  const holders: HolderInput[] = holdersRaw ? JSON.parse(holdersRaw) : [];
  const operatingInstruction = (formData.get("operatingInstruction") || undefined) as OperatingInstruction | undefined;

  return createClientCore({ ...parsed, holders, operatingInstruction }, session.user.id);
}

// --- Edit ----------------------------------------------------------------------------

const updateClientSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  mobile: z.string().min(1, "Mobile is required").optional(),
  email: z.string().email().optional().or(z.literal("")),
  pan: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v.trim().toUpperCase() : undefined))
    .refine((v) => !v || PAN_REGEX.test(v), "Invalid PAN format (expected e.g. ABCDE1234F)"),
  ckycRef: z.string().optional().or(z.literal("")),
  region: z.string().optional().or(z.literal("")),
  preferredLanguage: z.string().optional().or(z.literal("")),
  city: z.string().optional().or(z.literal("")),
  state: z.string().optional().or(z.literal("")),
  clientType: z.string().optional().or(z.literal("")),
  investmentCategory: z.string().optional().or(z.literal("")),
  leadSource: z.string().optional().or(z.literal("")),
  productInterest: z.string().optional().or(z.literal("")),
  existingBroker: z.string().optional().or(z.literal("")),
  tradingExperience: z.string().optional().or(z.literal("")),
  // A blank field means "leave unchanged" (same as any other omitted field), not "clear to 0" —
  // z.coerce.number() alone would turn "" into 0, so treat blank/absent as undefined first.
  expectedInvestment: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().optional()),
  referralSource: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  operatingInstruction: z.enum(["JOINTLY", "EITHER_OR_SURVIVOR", "ANYONE_OR_SURVIVOR"]).optional().or(z.literal("")),
  allowDuplicate: z.coerce.boolean().optional(),
});

export type UpdateClientResult =
  | { status: "updated"; client: { id: string; name: string } }
  | ({ status: "duplicate" } & DuplicateCheckResult);

const EDITABLE_FIELDS = [
  "name",
  "mobile",
  "email",
  "pan",
  "ckycRef",
  "region",
  "preferredLanguage",
  "city",
  "state",
  "clientType",
  "investmentCategory",
  "leadSource",
  "productInterest",
  "existingBroker",
  "tradingExperience",
  "expectedInvestment",
  "referralSource",
  "notes",
  "priority",
  "operatingInstruction",
] as const;

export async function updateClientAction(clientId: string, formData: FormData): Promise<UpdateClientResult> {
  const session = await requireUser();

  const raw: Record<string, unknown> = {};
  for (const field of [...EDITABLE_FIELDS, "allowDuplicate"] as const) {
    const value = formData.get(field);
    if (value !== null) raw[field] = value;
  }
  const input = updateClientSchema.parse(raw);

  const existing = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });

  const nextMobile = input.mobile !== undefined ? input.mobile : existing.mobile;
  const nextEmail = input.email !== undefined ? input.email || null : existing.email;
  const nextPan = input.pan !== undefined ? input.pan || null : existing.pan;
  const nextCkycRef = input.ckycRef !== undefined ? input.ckycRef || null : existing.ckycRef;

  const identityChanged =
    nextMobile !== existing.mobile || nextEmail !== existing.email || nextPan !== existing.pan || nextCkycRef !== existing.ckycRef;

  if (identityChanged) {
    const dupCheck = await checkDuplicateClientAction(nextMobile ?? undefined, nextEmail || "", nextPan ?? undefined, nextCkycRef ?? undefined, clientId);
    if (dupCheck.duplicate && (dupCheck.blocking || !input.allowDuplicate)) {
      return { status: "duplicate" as const, ...dupCheck };
    }
  }

  const data: Prisma.ClientUpdateInput = {};
  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};

  for (const field of EDITABLE_FIELDS) {
    if (input[field] === undefined) continue;
    const nextRaw = input[field];
    const next = field === "priority" || field === "expectedInvestment" || field === "name" || field === "mobile"
      ? nextRaw
      : (nextRaw as string) || null;
    const prev = existing[field as keyof typeof existing];
    if (next === prev) continue;
    (data as Record<string, unknown>)[field] = next;
    oldValue[field] = prev;
    newValue[field] = next;
  }

  const updated = await prisma.client.update({ where: { id: clientId }, data });

  if (Object.keys(newValue).length > 0) {
    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        entity: "Client",
        entityId: clientId,
        action: "edited",
        oldValue: oldValue as Prisma.InputJsonValue,
        newValue: newValue as Prisma.InputJsonValue,
      },
    });
    await logActivity({
      clientId,
      userId: session.user.id,
      type: "NOTE",
      payload: { message: `Edited: ${Object.keys(newValue).join(", ")}` },
    });
  }

  revalidateClient(clientId);
  return { status: "updated" as const, client: { id: updated.id, name: updated.name } };
}

// --- Archive / restore -----------------------------------------------------------------

export async function archiveClientAction(clientId: string, reason?: string) {
  const session = await requireRole(["ADMIN"]);
  await prisma.$transaction([
    prisma.client.update({ where: { id: clientId }, data: { isDeleted: true, deletedAt: new Date() } }),
    prisma.auditLog.create({
      data: { userId: session.user.id, entity: "Client", entityId: clientId, action: "archived", reason },
    }),
  ]);
  await logActivity({
    clientId,
    userId: session.user.id,
    type: "NOTE",
    payload: { message: `Client archived${reason ? `: ${reason}` : ""}` },
  });
  revalidateClient(clientId);
}

export async function restoreClientAction(clientId: string) {
  const session = await requireRole(["ADMIN"]);
  await prisma.$transaction([
    prisma.client.update({ where: { id: clientId }, data: { isDeleted: false, deletedAt: null } }),
    prisma.auditLog.create({
      data: { userId: session.user.id, entity: "Client", entityId: clientId, action: "restored" },
    }),
  ]);
  await logActivity({
    clientId,
    userId: session.user.id,
    type: "NOTE",
    payload: { message: "Client restored from archive" },
  });
  revalidateClient(clientId);
}

export type BulkReassignSummary = { clientId: string; clientName: string; newRmId: string; newRmName: string };

export async function bulkReassignClientsAction(
  clientIds: string[],
  targetRmId: string,
): Promise<{ reassigned: BulkReassignSummary[] }> {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const targetRm = await prisma.user.findUnique({ where: { id: targetRmId } });
  if (!targetRm) throw new Error("Target RM not found");

  const results: BulkReassignSummary[] = [];
  // Sequential — each client is its own small transaction; no shared state to keep in sync
  // (unlike auto-routing), but consistent with the codebase's other bulk-action loops.
  for (const clientId of clientIds) {
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true, assignedToId: true } });
    if (!client) continue;
    await assertMayReassign(session.user, client);

    await prisma.$transaction([
      prisma.client.update({ where: { id: clientId }, data: { assignedToId: targetRmId } }),
      prisma.auditLog.create({
        data: {
          userId: session.user.id,
          entity: "Client",
          entityId: clientId,
          action: "bulk_reassigned",
          oldValue: { assignedToId: client.assignedToId },
          newValue: { assignedToId: targetRmId },
          reason: `Bulk reassigned to ${targetRm.name}`,
        },
      }),
      prisma.activity.create({
        data: {
          clientId,
          userId: session.user.id,
          type: "NOTE",
          payload: { message: `Reassigned to ${targetRm.name} (bulk)` },
        },
      }),
      ...(targetRmId !== session.user.id
        ? [prisma.notification.create({ data: { userId: targetRmId, type: "new_assignment", payload: { clientId, clientName: client.name } } })]
        : []),
    ]);

    results.push({ clientId, clientName: client.name, newRmId: targetRmId, newRmName: targetRm.name });
  }

  revalidatePath("/clients");
  return { reassigned: results };
}

export type BulkClientOpSummary = { clientId: string; clientName: string };

export async function bulkPutOnHoldAction(clientIds: string[], reason: string): Promise<{ updated: BulkClientOpSummary[] }> {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const results: BulkClientOpSummary[] = [];
  // Sequential, matching bulkReassignClientsAction's established pattern above.
  for (const clientId of clientIds) {
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true, status: true } });
    if (!client || client.status !== "ACTIVE") continue; // putOnHold is only valid from ACTIVE, mirrors the UI gate
    await putOnHold(clientId, { reason: `${reason} (bulk action)` }, session.user.id);
    results.push({ clientId, clientName: client.name });
  }
  revalidatePath("/clients");
  return { updated: results };
}

export async function bulkMarkNotProceedingAction(clientIds: string[], reason: string): Promise<{ updated: BulkClientOpSummary[] }> {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const results: BulkClientOpSummary[] = [];
  for (const clientId of clientIds) {
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true, status: true } });
    if (!client || client.status === "NOT_PROCEEDING" || client.status === "COMPLETED") continue;
    await markNotProceeding(clientId, { reason: `${reason} (bulk action)` }, session.user.id);
    results.push({ clientId, clientName: client.name });
  }
  revalidatePath("/clients");
  return { updated: results };
}

export type BulkEditableClientFields = Partial<
  Pick<
    Client,
    | "priority"
    | "region"
    | "city"
    | "state"
    | "preferredLanguage"
    | "clientType"
    | "leadSource"
    | "productInterest"
    | "existingBroker"
    | "tradingExperience"
    | "referralSource"
  >
>;

const BULK_EDITABLE_FIELD_SELECT = {
  name: true,
  priority: true,
  region: true,
  city: true,
  state: true,
  preferredLanguage: true,
  clientType: true,
  leadSource: true,
  productInterest: true,
  existingBroker: true,
  tradingExperience: true,
  referralSource: true,
} as const;

/** Only fields actually present in `fields` are touched — a field the caller didn't set is left
 * untouched on every selected client, never overwritten to blank. Sequential loop, matching
 * bulkReassignClientsAction's established pattern above. */
export async function bulkUpdateClientFieldsAction(
  clientIds: string[],
  fields: BulkEditableClientFields,
): Promise<{ updated: BulkClientOpSummary[] }> {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined && v !== "");
  if (entries.length === 0) throw new Error("No fields to update");
  const data = Object.fromEntries(entries) as BulkEditableClientFields;
  const fieldNames = entries.map(([k]) => k);

  const results: BulkClientOpSummary[] = [];
  for (const clientId of clientIds) {
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: BULK_EDITABLE_FIELD_SELECT });
    if (!client) continue;

    const clientAsRecord = client as unknown as Record<string, unknown>;
    const oldValue = Object.fromEntries(fieldNames.map((key) => [key, clientAsRecord[key]]));

    await prisma.$transaction([
      prisma.client.update({ where: { id: clientId }, data }),
      prisma.auditLog.create({
        data: {
          userId: session.user.id,
          entity: "Client",
          entityId: clientId,
          action: "bulk_updated",
          oldValue: oldValue as Prisma.InputJsonValue,
          newValue: data as Prisma.InputJsonValue,
        },
      }),
      prisma.activity.create({
        data: { clientId, userId: session.user.id, type: "NOTE", payload: { message: `Updated ${fieldNames.join(", ")} (bulk)` } },
      }),
    ]);

    results.push({ clientId, clientName: client.name });
  }

  revalidatePath("/clients");
  return { updated: results };
}

/** Logging an activity means the RM has taken the action a pending task was tracking — mirrors
 * completeTaskAction's own side effects (syncNextAction) in reverse. */
async function completeOpenTasks(clientId: string): Promise<void> {
  const openTasks = await prisma.task.findMany({
    where: { clientId, status: { in: ["PENDING", "OVERDUE"] } },
    select: { id: true },
  });
  if (openTasks.length === 0) return;
  await prisma.task.updateMany({ where: { id: { in: openTasks.map((t) => t.id) } }, data: { status: "DONE" } });
  await syncNextAction(clientId);
}

/** Any authenticated role, matching single-client addClientNoteAction's own gate — bulk shouldn't
 * be more restrictive than doing it one at a time. */
export async function bulkAddNoteAction(clientIds: string[], note: string): Promise<{ updated: BulkClientOpSummary[] }> {
  const session = await requireUser();
  const results: BulkClientOpSummary[] = [];
  for (const clientId of clientIds) {
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } });
    if (!client) continue;
    await logActivity({ clientId, userId: session.user.id, type: "NOTE", payload: { message: `${note} (bulk)` } });
    await completeOpenTasks(clientId);
    results.push({ clientId, clientName: client.name });
  }
  revalidatePath("/clients");
  revalidatePath("/tasks");
  return { updated: results };
}

/** Who may move a client to another RM: Admins any client; Managers clients in their team or unassigned;
 * an RM only a client currently assigned to them (a hand-off). Everyone else — Dealers, partners — never. */
async function assertMayReassign(user: { id: string; role: Role }, client: { assignedToId: string | null }) {
  if (user.role === "ADMIN") return;
  if (user.role === "MANAGER") {
    const visible = await getVisibleUserIds(user.id, user.role);
    if (!client.assignedToId || (visible && visible.includes(client.assignedToId))) return;
  } else if (user.role === "RM" && client.assignedToId === user.id) {
    return;
  }
  throw new Error("You don't have permission to reassign this client");
}

export async function reassignClientAction(clientId: string, assignedToId: string) {
  const session = await requireUser();

  const existing = await prisma.client.findFirst({ where: { id: clientId, isDeleted: false }, select: { assignedToId: true } });
  if (!existing) throw new Error("Client not found");
  await assertMayReassign(session.user, existing);

  const target = await prisma.user.findFirst({ where: { id: assignedToId, isActive: true, role: { in: ["RM", "MANAGER", "ADMIN"] } }, select: { id: true } });
  if (!target) throw new Error("That user can't be assigned clients");

  await prisma.client.update({ where: { id: clientId }, data: { assignedToId } });

  const newOwner = await prisma.user.findUnique({ where: { id: assignedToId } });
  await logActivity({
    clientId,
    userId: session.user.id,
    type: "NOTE",
    payload: { message: `Reassigned to ${newOwner?.name ?? assignedToId}` },
  });
  // Tell the new owner (bell + phone push) — essential in Manual assignment mode, where this is how an RM learns of a lead.
  if (assignedToId !== session.user.id) {
    const assignedClient = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } });
    await prisma.notification.create({
      data: { userId: assignedToId, type: "new_assignment", payload: { clientId, clientName: assignedClient?.name ?? "a client" } },
    });
  }

  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
}

const NOTE_LOGGABLE_TYPES: ActivityType[] = ["NOTE", "CONTACT", "MEETING"];

export async function addClientNoteAction(clientId: string, note: string, type: ActivityType = "NOTE") {
  const session = await requireUser();
  const activityType = NOTE_LOGGABLE_TYPES.includes(type) ? type : "NOTE";

  await logActivity({ clientId, userId: session.user.id, type: activityType, payload: { message: note } });
  await completeOpenTasks(clientId);

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/tasks");
}

/**
 * Admin-only removal of an erroneous free-text NOTE (e.g. a duplicate "Funding status: ..." entry
 * from a resubmitted form). Deliberately restricted to NOTE — every other ActivityType is a system-
 * generated audit trail entry (stage/status changes, completed tasks, messages, calls, journeys)
 * and must never be deletable from here.
 */
export async function deleteActivityNoteAction(activityId: string) {
  await requireRole(["ADMIN"]);

  const activity = await prisma.activity.findUnique({ where: { id: activityId }, select: { id: true, clientId: true, type: true } });
  if (!activity) throw new Error("Activity not found");
  if (activity.type !== "NOTE") throw new Error("Only note entries can be removed");

  await prisma.activity.delete({ where: { id: activityId } });
  revalidatePath(`/clients/${activity.clientId}`);
}

export async function sendClientMessageAction(
  clientId: string,
  channel: "whatsapp" | "sms",
  templateId: string,
  variables: Record<string, string>,
) {
  const session = await requireUser();

  // Same IDOR guard the client detail page uses — previously any signed-in user could message any client by id.
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);
  if (visibleUserIds) {
    const target = await prisma.client.findUnique({ where: { id: clientId }, select: { assignedToId: true } });
    if (!target || !target.assignedToId || !visibleUserIds.includes(target.assignedToId)) {
      throw new Error("Client not found");
    }
  }

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

export async function verifyAllDocumentsAction(clientId: string, holderId: string | null) {
  const session = await requireUser();
  const result = await verifyAllDocuments(clientId, session.user.id, holderId);
  revalidateClient(clientId);
  return result;
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
  // KYC decisions are an approver's call — Admins and Managers only. A Manager may only decide for clients
  // inside their own team (or an unassigned lead they've been asked to handle).
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { assignedToId: true } });
  if (!client) throw new Error("Client not found");
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);
  if (visibleUserIds && client.assignedToId && !visibleUserIds.includes(client.assignedToId)) {
    throw new Error("You can only approve KYC for clients in your team");
  }
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
  const result = await updateFunding(
    clientId,
    { ...input, fundingDate: input.fundingDate ? new Date(input.fundingDate) : undefined },
    session.user.id,
  );
  revalidateClient(clientId);
  return result;
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
    preferredSegments?: string[];
    riskProfile?: string;
    maxOrderValue?: number;
    maxExposureLimit?: number;
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

export async function markOnboardingCompletedAction(clientId: string) {
  const session = await requireUser();
  const result = await markOnboardingCompleted(clientId, session.user.id);
  revalidateClient(clientId);
  return result;
}

export async function correctStageAction(clientId: string, toStageId: string, reason: string): Promise<{ pendingApproval: boolean }> {
  const session = await requireRole(["ADMIN", "MANAGER"]);

  const decision = await can({ id: session.user.id, role: session.user.role }, "client:stage_override");
  if (decision.effect === "DENY") throw new Error(decision.reason);
  if (decision.effect === "REQUIRE_APPROVAL") {
    await requestApproval(
      "STAGE_OVERRIDE",
      { entity: "Client", entityId: clientId, payload: { clientId, toStageId, reason }, reason },
      { id: session.user.id, role: session.user.role },
    );
    revalidateClient(clientId);
    return { pendingApproval: true };
  }

  await correctStage(clientId, toStageId, reason, session.user.id);
  revalidateClient(clientId);
  return { pendingApproval: false };
}

export async function putOnHoldAction(
  clientId: string,
  input: { reason: string; expectedResumeDate?: string; notes?: string },
) {
  // ADMIN/MANAGER only — matches bulkPutOnHoldAction's gate. Pausing the SLA clock is a control an
  // RM shouldn't be able to self-serve on their own (possibly overdue) clients.
  const session = await requireRole(["ADMIN", "MANAGER"]);
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

export async function mergeClientsAction(primaryId: string, duplicateIds: string[]): Promise<{ merged: MergeSummary[] }> {
  const session = await requireRole(["ADMIN", "MANAGER", "RM"]);
  const targets = [...new Set(duplicateIds)].filter((id) => id !== primaryId);
  if (targets.length === 0) throw new Error("No valid duplicates to merge");

  const results: MergeSummary[] = [];
  // Sequential, not parallel — the next duplicate's 1:1-relation conflict check (Kyc/Funding/
  // Dealer) must see the primary's state as updated by the previous iteration's merge, not a
  // stale pre-loop snapshot. Same "sequential, no shared transaction across items" pattern as
  // bulkReassignClientsAction below.
  for (const duplicateId of targets) {
    results.push(await mergeOneDuplicate(primaryId, duplicateId, session.user.id));
  }

  await syncNextAction(primaryId);
  revalidatePath("/clients");
  revalidatePath(`/clients/${primaryId}`);
  return { merged: results };
}

async function mergeOneDuplicate(primaryId: string, duplicateId: string, actorId: string): Promise<MergeSummary> {
  // One interactive transaction: the checks and the writes are atomic and a second concurrent merge of the same duplicate is refused.
  try {
    return await prisma.$transaction((tx) => mergeClientRecords(tx, primaryId, duplicateId, actorId));
  } catch (error) {
    if (error instanceof MergeBlockedError) throw new Error(error.message);
    throw error;
  }
}

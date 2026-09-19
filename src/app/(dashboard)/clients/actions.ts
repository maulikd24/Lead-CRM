"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireUser, requireRole } from "@/lib/auth/require-role";
import { logActivity } from "@/lib/activities/log-activity";
import { sendMessage } from "@/lib/messaging/send";
import { generateClientCode } from "@/lib/stage-engine/client-code";
import { getStageByName } from "@/lib/stage-engine/stages";
import { syncNextAction } from "@/lib/stage-engine/next-action";
import { normalizePhone, normalizeEmail, normalizePan, PAN_REGEX } from "@/lib/utils/normalize-contact";
import { pickAssignee } from "@/lib/assignment/routing-engine";
import { can } from "@/lib/policy/can";
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
  correctStage,
  putOnHold,
  resumeFromHold,
  markNotProceeding,
  reopenClient,
  verifyAllDocuments,
} from "@/lib/stage-engine/transitions";
import { Prisma } from "@/generated/prisma/client";
import type { Client, KycStatus, FundingStatus, DealerIntroStatus, DocumentStatus, OperatingInstruction } from "@/generated/prisma/client";
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
  mobile: string;
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
  mobile: string,
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
  const mobileExact = await prisma.client.findFirst({
    where: { mobile, mergedIntoId: null, isDeleted: false, ...notSelf },
    select: DUPLICATE_SELECT,
  });
  if (mobileExact) return { duplicate: mobileExact, reason: "mobile", blocking: true };

  const normMobile = normalizePhone(mobile);
  if (normMobile) {
    const mobileCandidates = await prisma.client.findMany({
      where: { mergedIntoId: null, isDeleted: false, ...notSelf },
      select: DUPLICATE_SELECT,
    });
    const mobileNormMatch = mobileCandidates.find((c) => normalizePhone(c.mobile) === normMobile);
    if (mobileNormMatch) return { duplicate: mobileNormMatch, reason: "mobile", blocking: true };
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
  mobile: string;
  email?: string;
  pan?: string;
  ckycRef?: string;
  region?: string;
  preferredLanguage?: string;
  clientType?: string;
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
};

export type CreateClientResult =
  | { status: "created"; client: { id: string; clientCode: string; name: string }; unassigned: boolean }
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
  if (!assignedToId) {
    // New leads auto-assign through the routing engine by default; the creator can still
    // override by picking an RM explicitly.
    const pick = await pickAssignee({
      clientType: input.clientType || null,
      expectedInvestment: null,
      region: input.region || null,
      preferredLanguage: input.preferredLanguage || null,
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
        name: input.name,
        mobile: input.mobile,
        email: input.email || null,
        pan: input.pan ? normalizePan(input.pan) : null,
        ckycRef: input.ckycRef || null,
        region: input.region || null,
        preferredLanguage: input.preferredLanguage || null,
        clientType: input.clientType || null,
        leadSource: input.leadSource || "manual",
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
          action: "auto_assign_failed",
          reason: "No eligible RM found (availability/capacity/region/language/HNI constraints)",
        },
      }),
      logActivity({
        clientId: client.id,
        userId: actorUserId,
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

  await initializeClient(client.id, actorUserId);

  for (const holder of holders) {
    await addHolderCore(client.id, holder, actorUserId);
  }

  revalidatePath("/clients");
  return {
    status: "created" as const,
    client: { id: client.id, clientCode: client.clientCode, name: client.name },
    unassigned: autoAssignFailed,
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
    const dupCheck = await checkDuplicateClientAction(nextMobile, nextEmail || "", nextPan ?? undefined, nextCkycRef ?? undefined, clientId);
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
  await completeOpenTasks(clientId);

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/tasks");
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

export type MergeSummary = { duplicateId: string; duplicateName: string; conflicts: string[] };

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
  const [primaryKyc, duplicateKyc, primaryFunding, duplicateFunding, primaryDealer, duplicateDealer, duplicateClient, primaryHolders, duplicateHolders] =
    await Promise.all([
      prisma.kycRecord.findUnique({ where: { clientId: primaryId } }),
      prisma.kycRecord.findUnique({ where: { clientId: duplicateId } }),
      prisma.fundingRecord.findUnique({ where: { clientId: primaryId } }),
      prisma.fundingRecord.findUnique({ where: { clientId: duplicateId } }),
      prisma.dealerIntroduction.findUnique({ where: { clientId: primaryId } }),
      prisma.dealerIntroduction.findUnique({ where: { clientId: duplicateId } }),
      prisma.client.findUnique({ where: { id: duplicateId }, select: { name: true, clientCode: true } }),
      prisma.accountHolder.findMany({ where: { clientId: primaryId, isDeleted: false } }),
      prisma.accountHolder.findMany({ where: { clientId: duplicateId, isDeleted: false } }),
    ]);

  // Joint-holder accounts can't be silently merged — reparenting could exceed the 3-holder cap or
  // collide on First/Second/Third position. Block rather than corrupt data; an RM can resolve
  // manually (e.g. remove a holder first) and retry.
  if (duplicateHolders.length > 0) {
    if (primaryHolders.length + duplicateHolders.length > 2) {
      throw new Error(
        `Cannot merge: combining holders would exceed the 3-holder limit (primary has ${primaryHolders.length + 1}, duplicate has ${duplicateHolders.length + 1})`,
      );
    }
    const primaryPositions = new Set(primaryHolders.map((h) => h.position));
    const colliding = duplicateHolders.find((h) => h.position && primaryPositions.has(h.position));
    if (colliding) {
      throw new Error(`Cannot merge: both accounts already have a ${colliding.position?.toLowerCase()} holder`);
    }
  }

  const conflicts: string[] = [];
  const operations: Prisma.PrismaPromise<unknown>[] = [
    prisma.document.updateMany({ where: { clientId: duplicateId }, data: { clientId: primaryId } }),
    prisma.task.updateMany({ where: { clientId: duplicateId }, data: { clientId: primaryId } }),
    prisma.activity.updateMany({ where: { clientId: duplicateId }, data: { clientId: primaryId } }),
    prisma.stageHistory.updateMany({ where: { clientId: duplicateId }, data: { clientId: primaryId } }),
    prisma.exception.updateMany({ where: { clientId: duplicateId }, data: { clientId: primaryId } }),
    // TradingAccount has no uniqueness tied to clientId, so — unlike AccountHolder — this is always
    // safe to reparent unconditionally. RevenueEvent.clientId is a denormalized copy of the same
    // ownership fact (via its TradingAccount); left un-reparented it would silently go stale the
    // moment the account above moves, so it's fixed in the same pass.
    prisma.tradingAccount.updateMany({ where: { clientId: duplicateId }, data: { clientId: primaryId } }),
    prisma.revenueEvent.updateMany({ where: { clientId: duplicateId }, data: { clientId: primaryId } }),
  ];

  if (duplicateHolders.length > 0) {
    operations.push(prisma.accountHolder.updateMany({ where: { clientId: duplicateId }, data: { clientId: primaryId } }));
  }

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
        userId: actorId,
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
        userId: actorId,
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

  return { duplicateId, duplicateName: duplicateClient?.name ?? duplicateId, conflicts };
}

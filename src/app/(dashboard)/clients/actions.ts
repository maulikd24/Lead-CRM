"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireRole, requireAccess } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { logActivity } from "@/lib/activities/log-activity";
import { sendMessage } from "@/lib/messaging/send";
import { generateClientCode } from "@/lib/stage-engine/client-code";
import { getStageByName } from "@/lib/stage-engine/stages";
import { syncNextAction } from "@/lib/stage-engine/next-action";
import { normalizePan, PAN_REGEX } from "@/lib/utils/normalize-contact";
import { emailKey, phoneKey } from "@/lib/clients/identity-keys";
import { pickAssignee } from "@/lib/assignment/routing-engine";
import { can } from "@/lib/policy/can";
import { mayMerge } from "@/lib/clients/merge-policy";
import { mergeClientRecords, MergeBlockedError, type MergeSummary } from "@/lib/clients/merge";
import { requestApproval } from "@/lib/policy/approvals/service";
import { maskContactFields } from "@/lib/privacy/contact-mask";
import { canRevealContact } from "@/lib/privacy/contact-reveal";
import { contactSearchClauses } from "@/lib/privacy/contact-search";
import { assertClientInScope } from "@/lib/clients/load-in-scope";
import { toBrowserDuplicate } from "@/lib/clients/duplicate-view";
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
import type { HolderInput } from "./holder-actions";
import { createClientCore, type CreateClientInput, type CreateClientResult } from "@/lib/clients/create-client";
import { findDuplicateClient, type DuplicateCheckResult } from "@/lib/clients/find-duplicate";

export type { CreateClientInput, CreateClientResult, DuplicateCheckResult };
import { emitCampaignLeadAttributed, emitLeadAssigned, emitLeadCreated } from "@/lib/events/producers-emit";

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

/** The match is shown to the user: contacts masked, PAN never returned, and a customer outside the caller's scope reduced to "exists" (see duplicate-view.ts). */
export async function checkDuplicateClientAction(
  mobile: string | undefined,
  email: string,
  pan?: string,
  ckycRef?: string,
  excludeId?: string,
): Promise<DuplicateCheckResult> {
  const session = await requireAccess("clients", "manage");
  const result = await findDuplicateClient(mobile, email, pan, ckycRef, excludeId);
  return toBrowserDuplicate(result, { role: session.user.role, visibleUserIds: await getVisibleUserIds(session.user.id, session.user.role) });
}

export async function searchClientsForMergeAction(query: string, excludeId: string) {
  const session = await requireRole(["ADMIN", "MANAGER", "RM"]);
  if (!query.trim()) return [];

  // An RM is offered only their own customers (the ones they may merge), so search cannot be used to browse other RMs'
  // customers. Admins and managers may merge any two customers, so their search is not limited by owner.
  const ownOnly = session.user.role === "RM";
  return prisma.client.findMany({
    where: {
      id: { not: excludeId },
      mergedIntoId: null,
      isDeleted: false,
      ...(ownOnly ? { assignedToId: session.user.id } : {}),
      AND: [{ OR: [
        { name: { contains: query, mode: "insensitive" } },
        ...contactSearchClauses(query, session.user.role === "ADMIN"),
        { clientCode: { contains: query, mode: "insensitive" } },
      ] }],
    },
    select: { id: true, name: true, clientCode: true, mobile: true, email: true },
    take: 8,
  }).then((rows) => rows.map(maskContactFields));
}

export async function createClientAction(formData: FormData) {
  const session = await requireAccess("clients", "manage");

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

  const result = await createClientCore({ ...parsed, holders, operatingInstruction }, session.user.id);
  if (result.status !== "duplicate") return result;
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);
  return toBrowserDuplicate(result, { role: session.user.role, visibleUserIds });
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
  | { status: "updated"; client: { id: string; name: string }; mobileChangeRequested?: boolean }
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
  const session = await requireAccess("clients", "manage");
  await assertClientInScope(session.user, clientId);

  const raw: Record<string, unknown> = {};
  for (const field of [...EDITABLE_FIELDS, "allowDuplicate"] as const) {
    const value = formData.get(field);
    if (value !== null) raw[field] = value;
  }
  // The edit form never carries the current mobile, email, CKYC reference or PAN (the page only has the masked form): blank means unchanged.
  for (const field of ["mobile", "email", "ckycRef", "pan"] as const) if (typeof raw[field] === "string" && !(raw[field] as string).trim()) delete raw[field];
  const input = updateClientSchema.parse(raw);

  const existing = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  // A PAN is only ever shown or changed by whoever may reveal it (Admin or the assigned RM); the dialog gets there through the audited reveal.
  if (input.pan && normalizePan(input.pan) !== (existing.pan ?? "") && !canRevealContact({ id: session.user.id, role: session.user.role }, existing)) {
    throw new Error("Only an Admin or the assigned RM can change the PAN");
  }
  // Only an Admin changes a number directly. Everyone else asks, and an Admin approves (see client-mobile-change.ts).
  let mobileChangeRequested = false;
  if (input.mobile !== undefined && input.mobile !== existing.mobile && session.user.role !== "ADMIN") {
    const newMobile = input.mobile.trim();
    const clash = phoneKey(newMobile) ? await prisma.client.findFirst({ where: { mobileKey: phoneKey(newMobile), id: { not: clientId }, mergedIntoId: null, isDeleted: false }, select: { id: true } }) : null;
    if (clash) throw new Error("Another customer already has this number. Merge the customers instead.");
    await requestApproval(
      "CLIENT_MOBILE_CHANGE",
      { entity: "Client", entityId: clientId, payload: { clientId, newMobile }, reason: "Customer number change requested" },
      { id: session.user.id, role: session.user.role },
    );
    mobileChangeRequested = true;
    delete input.mobile;
  }

  const nextMobile = input.mobile !== undefined ? input.mobile : existing.mobile;
  const nextEmail = input.email !== undefined ? input.email || null : existing.email;
  const nextPan = input.pan !== undefined ? input.pan || null : existing.pan;
  const nextCkycRef = input.ckycRef !== undefined ? input.ckycRef || null : existing.ckycRef;

  const identityChanged =
    nextMobile !== existing.mobile || nextEmail !== existing.email || nextPan !== existing.pan || nextCkycRef !== existing.ckycRef;

  if (identityChanged) {
    const dupCheck = await findDuplicateClient(nextMobile ?? undefined, nextEmail || "", nextPan ?? undefined, nextCkycRef ?? undefined, clientId);
    if (dupCheck.duplicate && (dupCheck.blocking || !input.allowDuplicate)) {
      return { status: "duplicate" as const, ...toBrowserDuplicate(dupCheck, { role: session.user.role, visibleUserIds: await getVisibleUserIds(session.user.id, session.user.role) }) };
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
  return { status: "updated" as const, client: { id: updated.id, name: updated.name }, mobileChangeRequested };
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

    const [, , reassignNote] = await prisma.$transaction([
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

    await emitLeadAssigned({ clientId, assigneeId: targetRmId, method: "manual", ref: reassignNote.id, actorUserId: session.user.id });
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
  const session = await requireAccess("clients", "manage");
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
  const session = await requireAccess("clients", "manage");

  const existing = await prisma.client.findFirst({ where: { id: clientId, isDeleted: false }, select: { assignedToId: true } });
  if (!existing) throw new Error("Client not found");
  await assertMayReassign(session.user, existing);

  const target = await prisma.user.findFirst({ where: { id: assignedToId, isActive: true, role: { in: ["RM", "MANAGER", "ADMIN"] } }, select: { id: true } });
  if (!target) throw new Error("That user can't be assigned clients");

  await prisma.client.update({ where: { id: clientId }, data: { assignedToId } });

  const newOwner = await prisma.user.findUnique({ where: { id: assignedToId } });
  const reassignNote = await logActivity({
    clientId,
    userId: session.user.id,
    type: "NOTE",
    payload: { message: `Reassigned to ${newOwner?.name ?? assignedToId}` },
  });
  await emitLeadAssigned({ clientId, assigneeId: assignedToId, method: "manual", ref: reassignNote.id, actorUserId: session.user.id });
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
  const session = await requireAccess("clients", "manage");
  const activityType = NOTE_LOGGABLE_TYPES.includes(type) ? type : "NOTE";

  await logActivity({ clientId, userId: session.user.id, type: activityType, payload: { message: note } });
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
  const session = await requireAccess("clients", "manage");

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
  const session = await requireAccess("clients", "manage");
  await recordRmContact(
    clientId,
    { ...input, nextActionDate: input.nextActionDate ? new Date(input.nextActionDate) : undefined },
    session.user.id,
  );
  revalidateClient(clientId);
}

export async function startDocumentCollectionAction(clientId: string) {
  await requireAccess("clients", "manage");
  await startDocumentCollection(clientId);
  revalidateClient(clientId);
}

export async function updateDocumentStatusAction(
  documentId: string,
  input: { status: DocumentStatus; rejectionReason?: string; remarks?: string },
) {
  const session = await requireAccess("clients", "manage");
  const doc = await updateDocumentStatus(documentId, input, session.user.id);
  revalidateClient(doc.clientId);
}

export async function verifyAllDocumentsAction(clientId: string, holderId: string | null) {
  const session = await requireAccess("clients", "manage");
  const result = await verifyAllDocuments(clientId, session.user.id, holderId);
  revalidateClient(clientId);
  return result;
}

export async function submitForKycAction(
  clientId: string,
  input: { submissionMethod?: string; kycReferenceNumber?: string; remarks?: string; override?: boolean },
) {
  const session = await requireAccess("clients", "manage");
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
  const session = await requireAccess("clients", "manage");
  const result = await updateFunding(
    clientId,
    { ...input, fundingDate: input.fundingDate ? new Date(input.fundingDate) : undefined },
    session.user.id,
  );
  revalidateClient(clientId);
  return { ...result, actorUserId: session.user.id };
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
  const session = await requireAccess("clients", "manage");
  await recordDealerIntroduction(
    clientId,
    { ...input, scheduledDate: input.scheduledDate ? new Date(input.scheduledDate) : undefined },
    session.user.id,
  );
  revalidateClient(clientId);
}

export async function markOnboardingCompletedAction(clientId: string) {
  const session = await requireAccess("clients", "manage");
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
  const session = await requireAccess("clients", "manage");
  await resumeFromHold(clientId, session.user.id);
  revalidateClient(clientId);
}

export async function markNotProceedingAction(clientId: string, input: { reason: string; notes?: string }) {
  const session = await requireAccess("clients", "manage");
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

  // Admins and managers may merge any two customers; an RM only customers assigned to them (merge-policy.ts). An unknown id
  // and a customer the RM may not merge get the same answer, so the action cannot be used to probe other RMs' customers.
  const involved = await prisma.client.findMany({ where: { id: { in: [primaryId, ...targets] } }, select: { id: true, assignedToId: true } });
  const found = new Set(involved.map((c) => c.id));
  if (![primaryId, ...targets].every((id) => found.has(id)) || !mayMerge({ id: session.user.id, role: session.user.role }, involved)) throw new Error("Customer not found");

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

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/activities/log-activity";
import { generateClientCode } from "@/lib/stage-engine/client-code";
import { getStageByName } from "@/lib/stage-engine/stages";
import { normalizePan } from "@/lib/utils/normalize-contact";
import { pickAssignee } from "@/lib/assignment/routing-engine";
import { initializeClient } from "@/lib/stage-engine/transitions";
import { Prisma } from "@/generated/prisma/client";
import type { OperatingInstruction, Priority } from "@/generated/prisma/client";
import { emitCampaignLeadAttributed, emitLeadAssigned, emitLeadCreated } from "@/lib/events/producers-emit";
import { findDuplicateClient, type RawDuplicateCheck } from "./find-duplicate";
import { addHolderCore, type HolderInput } from "./add-holder";

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
  | ({ status: "duplicate" } & RawDuplicateCheck);

/**
 * Not a server action (it trusts the actor it is given): it lives here so a browser can never call it directly. Callers: createClientAction, the CSV import, inbound webhooks.
 * The shared create path for both the single-client dialog and bulk CSV import — same
 * PAN-required validation, same PAN/CKYC hard-block vs. mobile/email soft-duplicate dedup, same
 * auto-assignment. Neither caller may bypass any of this.
 */
export async function createClientCore(input: CreateClientInput, actorUserId: string): Promise<CreateClientResult> {
  const dupCheck = await findDuplicateClient(input.mobile, input.email || "", input.pan, input.ckycRef);
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
      const recheck = await findDuplicateClient(input.mobile, input.email || "", input.pan, input.ckycRef);
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

  // Customer events (CUSTOMER_EVENTS_ENABLED, off by default): the facts of a new lead. Best effort, never throws, the old behaviour is untouched.
  await emitLeadCreated({ clientId: client.id, leadSource: client.leadSource, actorUserId });
  if (client.assignedToId) await emitLeadAssigned({ clientId: client.id, assigneeId: client.assignedToId, method: input.assignedToId ? "manual" : assignedToId ? "rule" : "manual", ref: "initial", actorUserId });
  await emitCampaignLeadAttributed({ clientId: client.id, leadSource: client.leadSource, attribution: (input.leadAttribution ?? null) as Record<string, unknown> | null });

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

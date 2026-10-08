"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { ASSET_CLASSES, CUSTOMER_CATEGORIES, OUTCOME_CHANNELS } from "@/lib/intelligence/constants";
import { recordInteractionOutcome } from "@/lib/intelligence/outcomes";
import { refreshCustomerIntelligence } from "@/lib/intelligence/refresh";
import { buildAgentBriefing } from "@/lib/intelligence/agent";

const ROLES = ["ADMIN", "MANAGER", "RM"] as const;

/** Same visibility the client page enforces: Admin anyone, Manager their team (and unassigned leads), RM their own. */
async function authorize(clientId: string) {
  const session = await requireRole([...ROLES]);
  const client = await prisma.client.findFirst({ where: { id: clientId, isDeleted: false, mergedIntoId: null }, select: { assignedToId: true } });
  if (!client) throw new Error("Client not found");
  const visible = await getVisibleUserIds(session.user.id, session.user.role);
  const allowed = visible === null || (client.assignedToId ? visible.includes(client.assignedToId) : session.user.role === "MANAGER");
  if (!allowed) throw new Error("You don't have access to this client");
  return session;
}

function revalidate(clientId: string) {
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/copilot");
  revalidatePath("/intelligence");
}

const outcomeSchema = z.object({
  clientId: z.string().min(1),
  outcome: z.enum(["INTERESTED", "NOT_INTERESTED", "FOLLOW_UP", "CONVERTED", "NOT_RELEVANT", "RM_HANDOVER", "SERVICE_ISSUE"]),
  channel: z.enum(OUTCOME_CHANNELS),
  assetClass: z.enum(ASSET_CLASSES).optional().or(z.literal("")),
  note: z.string().max(1000).optional(),
  followUpAt: z.string().optional(),
});

/** Record how an interaction went — the feedback that keeps acceptance and the next action honest. */
export async function logOutcomeAction(input: z.input<typeof outcomeSchema>) {
  const parsed = outcomeSchema.parse(input);
  const session = await authorize(parsed.clientId);
  const followUpAt = parsed.followUpAt ? new Date(parsed.followUpAt) : null;
  if (followUpAt && Number.isNaN(followUpAt.getTime())) throw new Error("Invalid follow-up date");
  if (parsed.outcome === "SERVICE_ISSUE" && !parsed.note?.trim()) throw new Error("Describe the service issue so someone can fix it");
  await recordInteractionOutcome({
    clientId: parsed.clientId,
    outcome: parsed.outcome,
    channel: parsed.channel,
    actorType: "RM",
    actorId: session.user.id,
    assetClass: parsed.assetClass || null,
    note: parsed.note,
    followUpAt,
  });
  revalidate(parsed.clientId);
}

/** An RM's own call on how open a customer is to an asset class; "AUTO" hands it back to the system. */
export async function setAcceptanceAction(clientId: string, assetClass: string, level: "HIGH" | "MEDIUM" | "LOW" | "AUTO") {
  const session = await authorize(clientId);
  if (!(ASSET_CLASSES as readonly string[]).includes(assetClass)) throw new Error("Unknown asset class");
  if (level === "AUTO") {
    await prisma.assetClassAcceptance.deleteMany({ where: { clientId, assetClass, isManual: true } });
  } else {
    await prisma.assetClassAcceptance.upsert({
      where: { clientId_assetClass: { clientId, assetClass } },
      update: { level, source: "manual", reason: `Set by ${session.user.name}`, isManual: true },
      create: { clientId, assetClass, level, source: "manual", reason: `Set by ${session.user.name}`, isManual: true },
    });
  }
  await refreshCustomerIntelligence(clientId);
  revalidate(clientId);
}

/** Mark a commitment or complaint as done, or dismiss one that was picked up wrongly. */
export async function resolveInsightAction(insightId: string, status: "DONE" | "DISMISSED") {
  const insight = await prisma.conversationInsight.findUnique({ where: { id: insightId }, select: { clientId: true, kind: true } });
  if (!insight) throw new Error("Not found");
  const session = await authorize(insight.clientId);
  await prisma.conversationInsight.update({ where: { id: insightId }, data: { status, resolvedAt: new Date(), resolvedById: session.user.id } });
  if (insight.kind === "COMMITMENT") {
    await prisma.task.updateMany({ where: { source: `commitment:${insightId}`, status: { in: ["PENDING", "OVERDUE"] } }, data: { status: status === "DONE" ? "DONE" : "CANCELLED" } });
  }
  await refreshCustomerIntelligence(insight.clientId);
  revalidate(insight.clientId);
}

const estimatesSchema = z.object({
  externalPortfolio: z.coerce.number().min(0).max(1e12).optional(),
  mfTransfer: z.coerce.number().min(0).max(1e12).optional(),
  idleCash: z.coerce.number().min(0).max(1e12).optional(),
  dematTransferStatus: z.enum(["", "NOT_STARTED", "IN_PROGRESS", "COMPLETED"]).optional(),
  mfTransferStatus: z.enum(["", "NOT_STARTED", "IN_PROGRESS", "COMPLETED"]).optional(),
});

/** What the customer holds elsewhere (an estimate) and where their transfers stand. Entered by hand, these win over AI guesses. */
export async function saveEstimatesAction(clientId: string, input: Record<string, string | number | undefined>) {
  await authorize(clientId);
  const parsed = estimatesSchema.parse(Object.fromEntries(Object.entries(input).map(([k, v]) => [k, v === "" ? undefined : v])));
  if (!(await prisma.customerIntelligence.findUnique({ where: { clientId }, select: { clientId: true } }))) await refreshCustomerIntelligence(clientId, { fireTriggers: false });
  await prisma.customerIntelligence.update({
    where: { clientId },
    data: {
      externalPortfolioEstimate: parsed.externalPortfolio ?? null,
      mfTransferEstimate: parsed.mfTransfer ?? null,
      idleCashEstimate: parsed.idleCash ?? null,
      dematTransferStatus: parsed.dematTransferStatus || null,
      mfTransferStatus: parsed.mfTransferStatus || null,
      estimatesSource: "rm",
      estimatesUpdatedAt: new Date(),
    },
  });
  await refreshCustomerIntelligence(clientId);
  revalidate(clientId);
}

export async function setCustomerCategoryAction(clientId: string, category: string) {
  await authorize(clientId);
  const value = category === "" ? null : category;
  if (value && !(CUSTOMER_CATEGORIES as readonly string[]).includes(value)) throw new Error("Unknown category");
  await prisma.client.update({ where: { id: clientId }, data: { customerCategory: value } });
  await refreshCustomerIntelligence(clientId);
  revalidate(clientId);
}

/** What an AI agent would be given before contacting this customer — shown to Admins/Managers so they can see exactly what it knows. */
export async function previewAgentBriefingAction(clientId: string): Promise<string> {
  const session = await authorize(clientId);
  if (session.user.role === "RM") throw new Error("Only Admins and Managers can preview the AI briefing");
  const briefing = await buildAgentBriefing(clientId);
  if (!briefing) throw new Error("Client not found");
  return JSON.stringify(briefing, null, 2);
}

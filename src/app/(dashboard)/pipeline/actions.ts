"use server";

import { prisma } from "@/lib/db/prisma";
import { loadClientInScope } from "@/lib/clients/load-in-scope";
import { hasContactRecord } from "@/lib/copilot/types";
import { loadKycSteps } from "@/lib/kyc/pipeline";
import { classifyDrop } from "@/lib/pipeline/board-logic";
import { correctStageAction } from "../clients/actions";

/**
 * What the board needs to show the next stage's own form for a dropped card — the same forms (and so the same gates)
 * as the client's Onboarding and Funding tabs.
 */
export async function getStageMoveContextAction(clientId: string, toStageId: string) {
  const { session, client } = await loadClientInScope(clientId, {
    documents: { orderBy: { createdAt: "asc" }, take: 50 },
    kycRecord: true,
    fundingRecord: true,
    dealerIntroduction: true,
    activities: { select: { type: true, payload: true }, orderBy: { createdAt: "desc" }, take: 200 },
  });
  const target = await prisma.stage.findUniqueOrThrow({ where: { id: toStageId } });
  if (classifyDrop(client.currentStage.sequence, target.sequence, session.user.role).kind !== "advance") {
    throw new Error("That isn't the next stage for this client");
  }
  const role = session.user.role;
  const [kycSteps, dealerUsers] = await Promise.all([
    target.name === "KYC completed" ? loadKycSteps(client.id) : Promise.resolve([]),
    target.name === "Introduction with Dealer"
      ? prisma.user.findMany({ where: { isActive: true, role: "DEALER" }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
  ]);
  const funding = client.fundingRecord;
  const dealer = client.dealerIntroduction;
  return {
    client: { id: client.id, name: client.name, status: client.status },
    target: { id: target.id, name: target.name },
    contacted: hasContactRecord(client.activities),
    startedDocs: client.documents.some((d) => !d.holderId),
    documents: client.documents,
    kycRecord: client.kycRecord,
    pendingKycSteps: kycSteps.filter((s) => s.status !== "VERIFIED" && s.status !== "SKIPPED").length,
    fundingRecord: funding ? { ...funding, amount: funding.amount === null ? null : Number(funding.amount) } : null,
    dealerIntroduction: dealer
      ? { ...dealer, maxOrderValue: dealer.maxOrderValue === null ? null : Number(dealer.maxOrderValue), maxExposureLimit: dealer.maxExposureLimit === null ? null : Number(dealer.maxExposureLimit) }
      : null,
    dealerUsers,
    canOverride: role === "ADMIN" || role === "MANAGER",
    canApproveKyc: role === "ADMIN" || role === "MANAGER",
  };
}

export type StageMoveContext = Awaited<ReturnType<typeof getStageMoveContextAction>>;

/** Skipping ahead or going back from the board: the client page's stage correction (Managers via approval), scope-checked first. */
export async function correctStageFromBoardAction(clientId: string, toStageId: string, reason: string) {
  await loadClientInScope(clientId, {});
  if (!reason.trim()) throw new Error("A reason is required to correct a stage");
  return correctStageAction(clientId, toStageId, reason.trim());
}

import { prisma } from "@/lib/db/prisma";
import type { Stage } from "@/generated/prisma/client";

/** The fixed 8-stage onboarding sequence — the single source of truth for names/order/default SLAs. */
export const STAGE_DEFINITIONS = [
  { name: "Lead Created", sequence: 1, slaHours: 4 },
  { name: "RM Reaches Out", sequence: 2, slaHours: 72 },
  { name: "Documents Collected", sequence: 3, slaHours: 72 },
  { name: "Documents Submitted for KYC", sequence: 4, slaHours: 24 },
  { name: "KYC Completed", sequence: 5, slaHours: 72 },
  { name: "Funds Added", sequence: 6, slaHours: 120 },
  { name: "Introduced with Dealer", sequence: 7, slaHours: 48 },
  { name: "Completed", sequence: 8, slaHours: 0 },
] as const;

export type StageName = (typeof STAGE_DEFINITIONS)[number]["name"];

export async function getStageBySequence(sequence: number): Promise<Stage> {
  return prisma.stage.findUniqueOrThrow({ where: { sequence } });
}

export async function getStageByName(name: StageName): Promise<Stage> {
  return prisma.stage.findUniqueOrThrow({ where: { name } });
}

export async function getAllStages(): Promise<Stage[]> {
  return prisma.stage.findMany({ orderBy: { sequence: "asc" } });
}

export async function getNextStage(currentSequence: number): Promise<Stage | null> {
  return prisma.stage.findUnique({ where: { sequence: currentSequence + 1 } });
}

/** True unless the target is exactly the next stage in sequence (no skipping, no going backward via the normal path). */
export function isSequentialAdvance(fromSequence: number, toSequence: number): boolean {
  return toSequence === fromSequence + 1;
}

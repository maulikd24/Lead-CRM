"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { requireRole, requireUser } from "@/lib/auth/require-role";
import { validateJourneyGraph } from "@/lib/journeys/schema";
import { enrollLeadManually } from "@/lib/journeys/dispatch";
import type { JourneyGraph } from "@/lib/journeys/types";

const EMPTY_GRAPH: JourneyGraph = {
  nodes: [
    {
      id: "trigger-1",
      type: "trigger",
      position: { x: 0, y: 0 },
      data: { triggerType: "lead_created" },
    },
  ],
  edges: [],
};

export async function createJourneyAction(name: string) {
  const session = await requireRole(["ADMIN", "MANAGER"]);

  const journey = await prisma.journey.create({
    data: {
      name: name || "Untitled Journey",
      definition: EMPTY_GRAPH as unknown as object,
      createdById: session.user.id,
    },
  });

  revalidatePath("/journeys");
  redirect(`/journeys/${journey.id}`);
}

export async function saveJourneyGraphAction(journeyId: string, graph: JourneyGraph) {
  await requireRole(["ADMIN", "MANAGER"]);

  const validated = validateJourneyGraph(graph);

  const inFlightRuns = await prisma.journeyRun.count({
    where: { journeyId, status: { in: ["RUNNING", "WAITING"] } },
  });
  if (inFlightRuns > 0) {
    throw new Error(
      `Cannot edit: ${inFlightRuns} lead(s) are currently in this journey. Deactivate it first.`,
    );
  }

  await prisma.journey.update({
    where: { id: journeyId },
    data: { definition: validated as unknown as object, version: { increment: 1 } },
  });

  revalidatePath(`/journeys/${journeyId}`);
}

export async function setJourneyActiveAction(journeyId: string, isActive: boolean) {
  await requireRole(["ADMIN", "MANAGER"]);

  await prisma.journey.update({ where: { id: journeyId }, data: { isActive } });

  revalidatePath("/journeys");
  revalidatePath(`/journeys/${journeyId}`);
}

export async function deleteJourneyAction(journeyId: string) {
  await requireRole(["ADMIN", "MANAGER"]);

  const inFlightRuns = await prisma.journeyRun.count({
    where: { journeyId, status: { in: ["RUNNING", "WAITING"] } },
  });
  if (inFlightRuns > 0) {
    throw new Error(`Cannot delete: ${inFlightRuns} lead(s) are currently in this journey.`);
  }

  await prisma.journeyRunStep.deleteMany({ where: { run: { journeyId } } });
  await prisma.journeyRun.deleteMany({ where: { journeyId } });
  await prisma.journey.delete({ where: { id: journeyId } });

  revalidatePath("/journeys");
  redirect("/journeys");
}

export async function enrollLeadInJourneyAction(journeyId: string, leadId: string) {
  await requireUser();
  await enrollLeadManually(journeyId, leadId);
  revalidatePath(`/leads/${leadId}`);
}

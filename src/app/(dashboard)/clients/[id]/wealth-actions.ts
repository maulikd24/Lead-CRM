"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { logActivity } from "@/lib/activities/log-activity";

const checkupSchema = z.object({
  clientId: z.string().min(1),
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]),
  reportUrl: z.string().optional(),
  keyFindings: z.string().optional(),
});

export async function updateWealthHealthCheckupAction(formData: FormData) {
  const session = await requireUser();

  const parsed = checkupSchema.parse({
    clientId: formData.get("clientId"),
    status: formData.get("status"),
    reportUrl: formData.get("reportUrl") || undefined,
    keyFindings: formData.get("keyFindings") || undefined,
  });

  await prisma.wealthHealthCheckup.upsert({
    where: { clientId: parsed.clientId },
    update: {
      status: parsed.status,
      reportUrl: parsed.reportUrl,
      keyFindings: parsed.keyFindings,
      performedById: session.user.id,
      completedAt: parsed.status === "COMPLETED" ? new Date() : null,
    },
    create: {
      clientId: parsed.clientId,
      status: parsed.status,
      reportUrl: parsed.reportUrl,
      keyFindings: parsed.keyFindings,
      performedById: session.user.id,
      completedAt: parsed.status === "COMPLETED" ? new Date() : null,
    },
  });

  await logActivity({
    clientId: parsed.clientId,
    userId: session.user.id,
    type: "NOTE",
    payload: { message: `Wealth Health Checkup: ${parsed.status.replace(/_/g, " ")}` },
  });

  revalidatePath(`/clients/${parsed.clientId}`);
}

const profileSchema = z.object({
  clientId: z.string().min(1),
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]),
  investorRiskProfile: z.enum(["Conservative", "Moderate", "Aggressive"]).optional(),
  investmentHorizonYears: z.coerce.number().int().positive().optional(),
  liquidityRequirement: z.string().optional(),
  goals: z.string().optional(),
});

export async function updateSmartAllvestProfileAction(formData: FormData) {
  const session = await requireUser();

  const parsed = profileSchema.parse({
    clientId: formData.get("clientId"),
    status: formData.get("status"),
    investorRiskProfile: formData.get("investorRiskProfile") || undefined,
    investmentHorizonYears: formData.get("investmentHorizonYears") || undefined,
    liquidityRequirement: formData.get("liquidityRequirement") || undefined,
    goals: formData.get("goals") || undefined,
  });

  const goals = parsed.goals
    ? parsed.goals
        .split("\n")
        .map((g) => g.trim())
        .filter(Boolean)
        .map((goal) => ({ goal }))
    : undefined;

  await prisma.smartAllvestProfile.upsert({
    where: { clientId: parsed.clientId },
    update: {
      status: parsed.status,
      investorRiskProfile: parsed.investorRiskProfile,
      investmentHorizonYears: parsed.investmentHorizonYears,
      liquidityRequirement: parsed.liquidityRequirement,
      goals,
    },
    create: {
      clientId: parsed.clientId,
      status: parsed.status,
      investorRiskProfile: parsed.investorRiskProfile,
      investmentHorizonYears: parsed.investmentHorizonYears,
      liquidityRequirement: parsed.liquidityRequirement,
      goals,
    },
  });

  await logActivity({
    clientId: parsed.clientId,
    userId: session.user.id,
    type: "NOTE",
    payload: { message: `Smart Allvest profile updated: ${parsed.status.replace(/_/g, " ")}` },
  });

  revalidatePath(`/clients/${parsed.clientId}`);
}

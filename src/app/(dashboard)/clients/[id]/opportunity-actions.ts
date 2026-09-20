"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth/require-role";
import { createOpportunity, changeOpportunityStage } from "@/lib/opportunity-engine/transitions";

const OPPORTUNITY_PRODUCTS = ["MUTUAL_FUND", "BROKING", "PMS", "AIF", "BONDS", "FIXED_INCOME", "UNLISTED_PRE_IPO", "OTHER"] as const;
const OPPORTUNITY_STAGES = [
  "IDENTIFIED",
  "DISCUSSED",
  "INTERESTED",
  "RECOMMENDATION",
  "DECISION_PENDING",
  "COMMITTED",
  "FUNDED",
  "INVESTED",
  "LOST_DEFERRED",
] as const;

const createSchema = z.object({
  clientId: z.string().min(1),
  product: z.enum(OPPORTUNITY_PRODUCTS),
  estimatedValue: z.coerce.number().positive("Estimated value must be greater than zero"),
  ownerId: z.string().min(1),
});

export async function createOpportunityAction(formData: FormData) {
  const session = await requireUser();

  const parsed = createSchema.parse({
    clientId: formData.get("clientId"),
    product: formData.get("product"),
    estimatedValue: formData.get("estimatedValue"),
    ownerId: formData.get("ownerId"),
  });

  const opportunity = await createOpportunity({ ...parsed, actorId: session.user.id });

  revalidatePath(`/clients/${parsed.clientId}`);
  // Decimal fields aren't plain-serializable across the Server Action -> Client Component
  // boundary (same rule as passing props to a Client Component) — convert before returning.
  return { ...opportunity, estimatedValue: Number(opportunity.estimatedValue) };
}

const stageChangeSchema = z.object({
  opportunityId: z.string().min(1),
  clientId: z.string().min(1),
  toStage: z.enum(OPPORTUNITY_STAGES),
  reason: z.string().optional(),
});

export async function changeOpportunityStageAction(input: { opportunityId: string; clientId: string; toStage: string; reason?: string }) {
  const session = await requireUser();
  const parsed = stageChangeSchema.parse(input);

  const opportunity = await changeOpportunityStage({
    opportunityId: parsed.opportunityId,
    toStage: parsed.toStage,
    actorId: session.user.id,
    reason: parsed.reason || undefined,
  });

  revalidatePath(`/clients/${parsed.clientId}`);
  return { ...opportunity, estimatedValue: Number(opportunity.estimatedValue) };
}

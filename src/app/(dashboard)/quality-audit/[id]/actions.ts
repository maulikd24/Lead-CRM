"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";

const reviewSchema = z.object({
  reviewId: z.string().min(1),
  reviewNotes: z.string().optional(),
  overriddenScore: z.coerce.number().int().min(0).max(100).optional(),
});

export async function submitQualityReviewAction(formData: FormData) {
  const session = await requireRole(["ADMIN", "MANAGER"]);

  const parsed = reviewSchema.parse({
    reviewId: formData.get("reviewId"),
    reviewNotes: formData.get("reviewNotes") || undefined,
    overriddenScore: formData.get("overriddenScore") || undefined,
  });

  await prisma.conversationReview.update({
    where: { id: parsed.reviewId },
    data: {
      reviewedById: session.user.id,
      reviewedAt: new Date(),
      reviewNotes: parsed.reviewNotes ?? null,
      overriddenScore: parsed.overriddenScore ?? null,
    },
  });

  revalidatePath(`/quality-audit/${parsed.reviewId}`);
  revalidatePath("/quality-audit");
}

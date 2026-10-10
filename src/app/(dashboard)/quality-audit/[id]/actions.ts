"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { canAccessReview } from "@/lib/quality/access";

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

  // Same visibility rule as the detail page: a manager may only review conversations of their own team (or ones nobody owns
  // yet). A missing review and an out-of-scope one get the same answer.
  const [existing, visibleUserIds] = await Promise.all([
    prisma.conversationReview.findUnique({ where: { id: parsed.reviewId }, select: { id: true, assignedRmId: true } }),
    getVisibleUserIds(session.user.id, session.user.role),
  ]);
  if (!existing || !canAccessReview(visibleUserIds, existing)) notFound();

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

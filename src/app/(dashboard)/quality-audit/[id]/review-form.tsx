"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { formatDateTime } from "@/lib/utils/format";
import { submitQualityReviewAction } from "./actions";

export function ReviewForm({
  reviewId,
  currentNotes,
  currentOverride,
  reviewedByName,
  reviewedAt,
}: {
  reviewId: string;
  currentNotes: string | null;
  currentOverride: number | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
}) {
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      await submitQualityReviewAction(formData);
      toast.success("Review saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save review");
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="reviewId" value={reviewId} />
      {reviewedAt && (
        <p className="text-xs text-muted-foreground">
          Last reviewed by {reviewedByName ?? "—"} on {formatDateTime(new Date(reviewedAt))}
        </p>
      )}
      <Field>
        <FieldLabel htmlFor="reviewNotes">Review notes</FieldLabel>
        <Textarea id="reviewNotes" name="reviewNotes" rows={3} defaultValue={currentNotes ?? ""} placeholder="Add any observations or context for this review" />
      </Field>
      <Field>
        <FieldLabel htmlFor="overriddenScore">Override quality score (optional)</FieldLabel>
        <Input id="overriddenScore" name="overriddenScore" type="number" min={0} max={100} defaultValue={currentOverride ?? ""} className="w-32" />
      </Field>
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Saving..." : "Save Review"}
      </Button>
    </form>
  );
}

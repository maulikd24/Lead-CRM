"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { motion } from "@/components/workspace";
import { markReviewedAction } from "@/app/(dashboard)/clients/[id]/360/outcomes-actions";
import type { OutcomesViewModel } from "@/lib/outcomes/view-model";
import { cn } from "@/lib/utils";

/** Review cadence for this customer's tier, and the one button that records a review as done (restarting the cadence). */
export function ReviewCard({ clientId, review, canEdit }: { clientId: string; review: OutcomesViewModel["review"]; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const mark = () =>
    start(async () => {
      const r = await markReviewedAction(clientId);
      if (r.ok) toast.success(r.message ?? "Review recorded");
      else toast.error(r.error);
    });
  return (
    <Card className={cn(motion.enter)} style={{ ["--i" as string]: 1 }}>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <CardTitle className="text-base">Review cadence</CardTitle>
        {review.hasCadence && <Badge variant={review.overdue ? "warning" : "success"}>{review.overdue ? "Overdue" : "On schedule"}</Badge>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{review.summary}</p>
        {canEdit && review.hasCadence && (
          <Button size="sm" variant="outline" className="w-fit" onClick={mark} disabled={pending}>
            {pending ? "Saving" : "Mark review done"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

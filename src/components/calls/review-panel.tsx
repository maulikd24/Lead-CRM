"use client";

import { useState, useTransition } from "react";
import { CheckCheck, ListPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils/format";
import { createFollowUpTaskAction, markCallReviewedAction, type CallActionResult } from "@/app/(dashboard)/calls/actions";

type Props = {
  activityId: string;
  defaultTaskTitle: string;
  task: { title: string; status: string; dueAtIso: string } | null;
  canMarkReviewed: boolean;
  canReviewNow: boolean;
  reviewedAtIso: string | null;
  reviewedByName: string | null;
  reviewNotes: string | null;
};

export function ReviewPanel(p: Props) {
  const [pendingTask, startTask] = useTransition();
  const [pendingReview, startReview] = useTransition();
  const [taskMade, setTaskMade] = useState(false);
  const [reviewedAt, setReviewedAt] = useState(p.reviewedAtIso);

  const report = (result: CallActionResult) => (result.ok ? toast.success(result.message) : toast.error(result.error));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Follow-up and review</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form
          className="flex flex-col gap-3"
          action={(fd) =>
            startTask(async () => {
              const result = await createFollowUpTaskAction(fd);
              if (result.ok) setTaskMade(true);
              report(result);
            })
          }
        >
          <input type="hidden" name="activityId" value={p.activityId} />
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Task
            <Input name="title" defaultValue={p.defaultTaskTitle} maxLength={200} className="text-sm text-foreground" />
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Due in
              <select name="dueInDays" defaultValue="1" className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30">
                <option value="1">1 day</option>
                <option value="2">2 days</option>
                <option value="3">3 days</option>
                <option value="7">1 week</option>
              </select>
            </label>
            <Button type="submit" disabled={pendingTask || taskMade}>
              <ListPlus aria-hidden="true" />
              {taskMade ? "Task created" : "Create follow-up task"}
            </Button>
          </div>
          {p.task && (
            <p className="text-xs text-muted-foreground">
              Existing task: &quot;{p.task.title}&quot; ({p.task.status.toLowerCase()}, due {formatDateTime(new Date(p.task.dueAtIso))}). A second task is only created once it is done.
            </p>
          )}
        </form>

        <div className="border-t border-border pt-5">
          {p.canMarkReviewed ? (
            <form
              className="flex flex-col gap-3"
              action={(fd) =>
                startReview(async () => {
                  const result = await markCallReviewedAction(fd);
                  if (result.ok) setReviewedAt(new Date().toISOString());
                  report(result);
                })
              }
            >
              <input type="hidden" name="activityId" value={p.activityId} />
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Reviewer note
                <Textarea name="note" rows={3} maxLength={2000} defaultValue={p.reviewNotes ?? ""} placeholder="What did you notice? What should the RM do differently?" className="text-sm text-foreground" />
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" variant="outline" disabled={pendingReview || !p.canReviewNow}>
                  <CheckCheck aria-hidden="true" />
                  {reviewedAt ? "Update review" : "Mark reviewed"}
                </Button>
                {!p.canReviewNow && <span className="text-xs text-muted-foreground">Available once the call has been analysed.</span>}
                {reviewedAt && (
                  <span className="text-xs text-muted-foreground">
                    Reviewed{p.reviewedByName ? ` by ${p.reviewedByName}` : ""} on {formatDateTime(new Date(reviewedAt))}
                  </span>
                )}
              </div>
            </form>
          ) : (
            <div className="text-sm text-muted-foreground">
              {p.reviewedAtIso ? (
                <>
                  <p>
                    Reviewed{p.reviewedByName ? ` by ${p.reviewedByName}` : ""} on {formatDateTime(new Date(p.reviewedAtIso))}
                  </p>
                  {p.reviewNotes && <p className="mt-1 text-foreground">{p.reviewNotes}</p>}
                </>
              ) : (
                <p>A manager has not reviewed this call yet.</p>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { rebuildPayoutRunAction, submitPayoutRunForApprovalAction, finalizePayoutRunAction } from "../../actions";
import type { PayoutRunStatus } from "@/generated/prisma/client";

export function RunActionsBar({ payoutRunId, status, canFinalize }: { payoutRunId: string; status: PayoutRunStatus; canFinalize: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleRebuild() {
    startTransition(async () => {
      try {
        await rebuildPayoutRunAction(payoutRunId);
        toast.success("Payout run rebuilt");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to rebuild");
      }
    });
  }

  function handleSubmit() {
    startTransition(async () => {
      try {
        await submitPayoutRunForApprovalAction(payoutRunId);
        toast.success("Submitted for approval");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to submit");
      }
    });
  }

  function handleFinalize() {
    startTransition(async () => {
      try {
        await finalizePayoutRunAction(payoutRunId);
        toast.success("Payout run finalized");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to finalize");
      }
    });
  }

  if (status === "DRAFT") {
    return (
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={pending} onClick={handleRebuild}>
          Rebuild
        </Button>
        <Button size="sm" disabled={pending} onClick={handleSubmit}>
          Submit for Approval
        </Button>
      </div>
    );
  }

  if (status === "APPROVED" && canFinalize) {
    return (
      <Button size="sm" disabled={pending} onClick={handleFinalize}>
        Finalize
      </Button>
    );
  }

  return null;
}

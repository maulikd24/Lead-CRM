"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { syncRevenueFromTransactionsAction, recomputeAccrualsAction } from "./actions";

export function SyncRecomputeButtons() {
  const [syncPending, startSync] = useTransition();
  const [recomputePending, startRecompute] = useTransition();

  function handleSync() {
    startSync(async () => {
      try {
        const { created, skipped } = await syncRevenueFromTransactionsAction();
        toast.success(`${created} revenue event${created === 1 ? "" : "s"} synced (${skipped} already up to date)`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Sync failed");
      }
    });
  }

  function handleRecompute() {
    startRecompute(async () => {
      try {
        const { computed, skipped } = await recomputeAccrualsAction();
        toast.success(`${computed} accrual${computed === 1 ? "" : "s"} computed (${skipped} skipped)`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Recompute failed");
      }
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" disabled={syncPending} onClick={handleSync}>
        {syncPending ? "Syncing..." : "Sync Revenue from Transactions"}
      </Button>
      <Button size="sm" variant="outline" disabled={recomputePending} onClick={handleRecompute}>
        {recomputePending ? "Recomputing..." : "Recompute Accruals"}
      </Button>
    </>
  );
}

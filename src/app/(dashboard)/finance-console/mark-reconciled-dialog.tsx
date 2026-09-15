"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { markPayoutReconciledAction } from "../earnings/actions";

/** Finance recording a fact about the external finance/payroll system — not a decision this app
 * makes, so unlike CommissionAdjustment/PayoutRun approval, this never routes through maker-checker. */
export function MarkReconciledDialog({ payoutId }: { payoutId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      const externalPayoutRef = String(formData.get("externalPayoutRef") ?? "").trim();
      await markPayoutReconciledAction(payoutId, externalPayoutRef);
      toast.success("Marked reconciled");
      setOpen(false);
      formRef.current?.reset();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to mark reconciled");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>Mark Reconciled</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark Reconciled</DialogTitle>
          <DialogDescription>
            Records that Allvest&apos;s external finance system confirmed this transfer. This app
            never executes the transfer itself.
          </DialogDescription>
        </DialogHeader>
        <form ref={formRef} action={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="externalPayoutRef">External Payout Reference</FieldLabel>
              <Input id="externalPayoutRef" name="externalPayoutRef" required />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

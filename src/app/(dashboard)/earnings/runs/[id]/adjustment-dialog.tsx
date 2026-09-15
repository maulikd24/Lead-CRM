"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { requestCommissionAdjustmentAction } from "../../actions";

/** Never writes a CommissionAdjustment directly — always routes through the maker-checker
 * ApprovalRequest queue (Admin decides), same discipline as a Manager's stage correction. */
export function AdjustmentDialog({ partnerProfileId, payoutId }: { partnerProfileId: string; payoutId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      const amount = Number(formData.get("amount"));
      const reason = String(formData.get("reason") ?? "");
      await requestCommissionAdjustmentAction({ partnerProfileId, payoutId, amount, reason });
      toast.success("Adjustment submitted for approval");
      setOpen(false);
      formRef.current?.reset();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to submit adjustment");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>Adjust</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Commission Adjustment</DialogTitle>
          <DialogDescription>
            Use a negative amount for a clawback. Never applies immediately — an Admin must approve
            it in the Approval Workflows queue first.
          </DialogDescription>
        </DialogHeader>
        <form ref={formRef} action={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="amount">Amount (₹)</FieldLabel>
              <Input id="amount" name="amount" type="number" step="0.01" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="reason">Reason</FieldLabel>
              <Textarea id="reason" name="reason" rows={3} required />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button type="submit" disabled={pending}>
              {pending ? "Submitting..." : "Submit for Approval"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

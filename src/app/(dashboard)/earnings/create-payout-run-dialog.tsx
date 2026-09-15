"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Plus } from "lucide-react";
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
import { createPayoutRunAction } from "./actions";

export function CreatePayoutRunDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      const run = await createPayoutRunAction(formData);
      toast.success("Payout run created");
      setOpen(false);
      formRef.current?.reset();
      router.push(`/earnings/runs/${run.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create payout run");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        Create Payout Run
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Payout Run</DialogTitle>
          <DialogDescription>
            Groups every ACCRUED commission accrual whose date falls inside this period into one
            Payout per partner. A DRAFT run can be rebuilt as often as needed before submission.
          </DialogDescription>
        </DialogHeader>
        <form ref={formRef} action={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="periodStart">Period Start</FieldLabel>
              <Input id="periodStart" name="periodStart" type="date" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="periodEnd">Period End</FieldLabel>
              <Input id="periodEnd" name="periodEnd" type="date" required />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button type="submit" disabled={pending}>
              {pending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
